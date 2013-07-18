define(function(require, exports) {
  'use strict';

  var Utils = require('utils');

  // ===========================================================
  // SchemaVersion Object

  var schemaVersions = new Map();
  var schemaVersionNamedRetrieval = new Map();

  var addSchemaVersion = function(schemaVersion) {
    var versionMap = schemaVersionNamedRetrieval.get(schemaVersion.name);
    if (!versionMap) {
      versionMap = new Map();
      schemaVersionNamedRetrieval.set(schemaVersion.name, versionMap);
    }
    versionMap.set(schemaVersion.version, schemaVersion);
  };

  function SchemaVersion(databaseName, version, options) {
    /**
     * SchemaVersion (constructor)
     *
     * @param {string} databaseName
     * @param {number} version - integer n, where 0 < n < 2^53.
     * @param {Object} options - an object containing:
     *       initializer {function} - initializes a new schema version.
     *       upgrader {function} - converts this schema version to schema
     *                             version n+1.
     *       downgrader {function} - converts this schema version to
     *                               schema version n-1.
     *
     * References to SchemaVersion's are maintained automatically
     */
    this.name = databaseName;
    this.version = version;
    Utils.extend(this, {
      initializer: null,
      upgrader: null,
      downgrader: null
    }, options);
    addSchemaVersion(this);
    schemaVersions.set(this, true);
  }

  SchemaVersion.noop = function(transaction, callback) {
    // A noop upgrader/downgrader
    callback(null);
  };

  SchemaVersion.error = function(transaction, callback) {
    // An upgrader/downgrader that reports an error
    callback(new Error('erroneous upgrader/downgrader'));
  };

  SchemaVersion.getSchemaVersions = function(databaseName) {
    /**
     * getSchemaVersions
     *
     * return the SchemaVersion objects for a particular databaseName
     */
    var ret = [];
    var databaseMap = schemaVersionNamedRetrieval.get(databaseName);
    if (databaseMap) {
      for (var i of databaseMap) {
        ret.push(i[1]);
      }
    }
    return ret.sort(Utils.data.keyedCompare('version'));
  };

  SchemaVersion.getAllSchemaVersions = function() {
    /**
     * getAllSchemaVersions
     *
     * @return {Array<SchemaVersion>} all the SchemaVersion objects.
     */
    var ret = [];
    for (var i of schemaVersions) {
      ret.push(i[0]);
    }
    return ret;
  };

  SchemaVersion.removeSchemaVersions = function(databaseName) {
    if (!databaseName) {
      schemaVersions.clear();
      schemaVersionNamedRetrieval.clear();
    } else {
      schemaVersionNamedRetrieval.delete(databaseName);
    }
  };

  SchemaVersion.completenessReport = function(databaseName) {
    /**
     * completenessReport
     *
     * @param {string} databaseName - database to check.
     * @return {object} a report of the schema completeness,
     *                  containing arrays of version numbers
     *                  missing init, up, or downgraders.
     */
    var report = {
      missingInitializers: [],
      missingUpgraders: [],
      missingDowngraders: []
    };
    var schemas = SchemaVersion.getSchemaVersions(databaseName);
    for (var i = 0; i < schemas.length; i++) {
      var first = i === 0;
      var last = i === schemas.length - 1;
      if (typeof schemas[i].initializer !== 'function') {
        report.missingInitializers.push(schemas[i].version);
      }
      if (!last && typeof schemas[i].upgrader !== 'function') {
        report.missingUpgraders.push(schemas[i].version);
      }
      if (!first && typeof schemas[i].downgraders !== 'function') {
        report.missingDowngraders.push(schemas[i].version);
      }
    }
    return report;
  };

  // ===========================================================
  // SchemaVersion Prototype

  SchemaVersion.prototype = {
    register: function sv_register(database) {
      if (this.initializer) {
        database.addInitializer(this.version, this.initializer);
      } else {
        throw new Error('Cannot add a Schema without an initializer');
      }
      if (this.upgrader) {
        database.addUpgrader(this.version, this.upgrader);
      }
      if (this.downgrader) {
        database.addDowngrader(this.version, this.downgrader);
      }
    }
  };

  // ===========================================================
  // Database Object

  function Database(options) {
    /**
     * Database (constructor)
     *
     * @param {object} options - containing:
     *       name {string} - database name.
     *       version {number} - integer n, where 0 < n < 2^53.
     *       schemas {list<string>} - a list of strings containing
     *            URLs (typically a db/schema_{version}.js naming scheme)
     *            that define the database Schemas. These will be lazy
     *            loaded when the effective version !== the source version.
     */
    Utils.extend(this, {
      initializers: [],
      upgraders: [],
      downgraders: []
    }, options);
  }

  // ===========================================================
  // Database Singletons

  var databaseSingletons = new Map();

  Database.singleton = Utils.singleton(Database, function(map, args) {
    return [args[0].name, map.get(args[0].name)];
  });

  // ===========================================================
  // Database Object Private Methods

  var createAdder = function(listName) {
    return function(version, fn) {
      var added = {
        version: version,
        fn: fn
      };
      Utils.data.sortedRemove(added, this[listName],
        Utils.data.keyedCompare('version'));
      Utils.data.sortedInsert(added, this[listName],
        Utils.data.keyedCompare('version'), true);
    };
  };

  var createRemover = function(listName) {
    return function(version) {
      var removed = { version: version };
      Utils.data.sortedRemove(removed, this[listName],
        Utils.data.keyedCompare('version'));
    };
  };

  // ===========================================================
  // Database Object Prototype

  Database.prototype = {
    addInitializer: createAdder('initializers'),
    removeInitializer: createRemover('initializers'),
    addUpgrader: createAdder('upgraders'),
    removeUpgrader: createRemover('upgraders'),
    addDowngrader: createAdder('downgraders'),
    removeDowngrader: createRemover('downgraders'),

    get effectiveVersionName() {
      return '__effectiveVersion__';
    },

    setLatestVersion: function(databaseName, version, callback) {
      /**
       * setLatestVersion @private
       *
       * @param {string} [databaseName] - name of database.
       * @param {number} version - effective version number to set.
       * @param {function} callback - call with (err).
       */
      if (arguments.length === 2 &&
          typeof arguments[0] === 'number' &&
          typeof arguments[1] === 'function') {
        // if no databaseName was passed, use `this`
        databaseName = this.name;
        version = arguments[0];
        callback = arguments[1];
      }
      this.requestMutatorTransaction(function(err, transaction) {
        var db = transaction.db;
        if (Array.prototype.indexOf.call(db.objectStoreNames,
          this.effectiveVersionName) !== -1) {
          db.deleteObjectStore(this.effectiveVersionName);
        }
        var ev = db.createObjectStore(this.effectiveVersionName);
        var req = ev.put({ number: version }, 0);
        req.onsuccess = function(ev) {
          transaction.db.close();
          callback && callback(null);
        };
        req.onerror = function(ev) {
          transaction.db.close();
          callback && callback(req.error);
        };
      }.bind(this));
    },

    getLatestVersion: function(databaseName, callback) {
      /**
       * getLatestVersion @private
       *
       * @param {string} [databaseName] - name of database.
       * @param {function} callback - call with result:
       *                              (err, versionNumber, effectiveNumber).
       */
      if (arguments.length === 1 && typeof arguments[0] === 'function') {
        // if no databaseName was passed, use `this`
        databaseName = this.name;
        callback = arguments[0];
      }
      var ignoreError = false;

      // Force an `onupgradeneeded` event so that we can query for the
      // effective version number. The request will be aborted in order
      // to prevent the request's side effects on the database.
      var req = indexedDB.open(databaseName, Math.pow(2, 53) - 1);
      var getEffective = (function(openEvent, transaction, callback) {
        var upgrade = transaction.mode === 'versionchange';
        var db = transaction.db;
        db.onversonchange = function(ev) {
          db.close();
        };
        var calloutAndCleanup = function(err, effective) {
          try {
            callback && callback(err,
              upgrade ? openEvent.oldVersion : Math.pow(2, 53) - 1,
              err !== null ? 0 : effective);
          } finally {
            db.close();
            ignoreError = true;
            transaction.abort();
          }
        };
        if ((!upgrade || openEvent.oldVersion > 0) &&
            Array.prototype.indexOf.call(db.objectStoreNames,
                                         this.effectiveVersionName) !== -1) {
          var ev = transaction.objectStore(this.effectiveVersionName);
          var req = ev.get(0);
          req.onsuccess = req.onerror = function(ev) {
            calloutAndCleanup(req.error,
              req.error === null ? req.result.number : 0);
          };
        } else {
          calloutAndCleanup(null, 0);
        }
      }).bind(this);

      // This function is invoked ~(1 - 10^-14) percent of the time, whenever
      // req.result.version < 2^53 - 1. The transaction will be aborted before
      // onsuccess is called, to prevent any changes from occurring.
      req.onupgradeneeded = function(ev) {
        getEffective(ev, ev.target.transaction, callback);
      };

      // Edge case: invoked when the IndexDB version number is maxed out.
      // This function is invoked ~(10^-14) percent of the time, whenever
      // req.result.version === 2^53 - 1. The transaction will be aborted.
      req.onsuccess = (function(ev) {
        var trans = req.result.transaction(
          this.effectiveVersionName, 'readonly');
        getEffective(ev, trans, callback);
      }).bind(this);

      req.onerror = req.onblocked = function(ev) {
        ev.preventDefault();
        // Every aborted transaction triggers an `onerror` event. Because we
        // are intentionally aborting the "open" transaction in order to avoid
        // side effects, we can safely ignore this event in  the successful
        // case.
        if (!ignoreError) {
          callback && callback(
            new Error('Error retrieving indexedDB version #'));
        }
      };
    },

    // ===========================================================
    // Database copying (IndexedDB problems)

    doubleCopyReset: function(callback) {
      /**
       * doubleCopyReset
       *
       * The indexedDB spec has some... erm... flaws. This method
       * is evidence of that fact. Since there is no way to downgrade
       * a database (onupgradeneeded is only called for >= version
       * changes), we use programmatically generated version numbers.
       *
       * Since there is no way of knowing how often these will be
       * called, and "X is enough for anyone" never works out (
       * even when X = 2^53 - 1), a method to loop back around to
       * start is necessary. That way, we can programmatically
       * generate onupgradeneeded events as we please, and never
       * worry about driving off the end of the earth. Even if we
       * don't, ourselves, generate 2^53 upgrade events, there is
       * no guarantee that we won't inherit a database that has a
       * manually set high version number.
       *
       * Here, we take the painstaking step of copying the entire
       * database to a temporary name, deleting the initial
       * database, and then reinstating it at version 1 and
       * copying the entire contents back again.
       *
       * Hopefully, the spec will be fixed before this ever needs
       * to be called in production.
       */
      var copyName = '__' + this.name + '__COPY__';
      var secondCopy = (function(err) {
        if (err) {
          callback(err);
        }
        var delreq = indexedDB.deleteDatabase(this.name);
        delreq.onsuccess = (function(ev) {
          // second copy
          this.copyToNew(copyName, this.name, callback);
        }).bind(this);
        delreq.onerror = function(ev) {
          callback(delreq.error);
        };
      }).bind(this);
      // first copy
      this.copyToNew(this.name, copyName, secondCopy);
    },

    extractSchema: function(trans) {
      var db = trans.db;
      var schema = {};
      Array.prototype.forEach.call(db.objectStoreNames, function(x) {
        var store = trans.objectStore(x);
        var osSchema = schema[x] = {
          indices: [],
          options: {
            keyPath: store.keyPath,
            autoincrement: store.autoincrement
          }
        };
        for (var i = 0; i < store.indexNames.length; i++) {
          var index = store.index(store.indexNames[i]);
          osSchema.indices.push({
            name: store.indexNames[i],
            keyPath: index.keyPath,
            multiEntry: index.multiEntry,
            unique: index.unique
          });
        }
      }.bind(this));
      return schema;
    },

    applySchema: function(schema, trans) {
      /**
       * applySchema
       *
       * Parameter schema {object} - schema collected from extractSchema
       * Parameter trans {IDBTransaction} - target upgrade transaction
       */
      var db = trans.db;
      for (var i in schema) {
        var obj = db.createObjectStore(i, schema[i].options);
        for (var j = 0; j < schema[i].indices.length; j++) {
          var def = schema[i].indices[j];
          obj.createIndex(def.name, def.keyPath, {
            multiEntry: def.multiEntry,
            unique: def.unique
          });
        }
      }
    },

    copyToNew: function(srcName, destName, callback) {
      /**
       * copyToNew
       *
       * Parameter srcName {string} - source database name.
       * Parameter destName {string} - destination database name.
       *
       * copies all data from indexedDB-srcName to indexedDB-destName,
       * and then calls the callback with any errors or null for success
       */
      var srcdb;
      var extractedSchema;
      var deletedDest = false;
      var putKV = (function(obj, key, value, cb) {
        var putit = (function() {
          var oreq = indexedDB.open(destName, 1);
          oreq.onupgradeneeded = (function(ev) {
            var db = oreq.result;
            var trans = ev.target.transaction;
            this.applySchema(extractedSchema, trans);
          }).bind(this);
          oreq.onsuccess = function(ev) {
            var db = oreq.result;
            var trans = db.transaction(obj, 'readwrite');
            var store = trans.objectStore(obj);
            var preq;
            if (store.keyPath) {
              preq = store.put(value);
            } else {
              preq = store.put(value, key);
            }
            preq.onsuccess = function(ev) {
              db.close();
              cb(null);
            };
            preq.onerror = function(ev) {
              db.close();
              cb(new Error('cannot put'));
            };
          };
          oreq.onerror = function(ev) {
            cb(new Error('cannot create destdb:' + destName));
          };
        }).bind(this);
        if (!deletedDest) {
          deletedDest = true;
          var delreq = indexedDB.deleteDatabase(destName);
          delreq.onsuccess = function(ev) {
            putit();
          };
          delreq.onerror = function(ev) {
            cb(new Error('cannot delete destdb:' + destName));
          };
        } else {
          putit();
        }
      }).bind(this);
      var gen = Utils.async.generator(function(err) {
        srcdb.close();
        callback && callback(err);
      });
      var done = gen();
      // Open the src database
      this.getLatestVersion(srcName,
        function(err, latestVersion, effectiveVersion) {
        var srcreq = indexedDB.open(srcName, latestVersion);
        srcreq.onsuccess = (function(ev) {
          srcdb = srcreq.result;
          var trans = srcdb.transaction(srcdb.objectStoreNames, 'readonly');
          extractedSchema = this.extractSchema(trans);
          for (var i = 0; i < srcdb.objectStoreNames.length; i++) {
            (function(i, cb) {
              // loop over object stores
              var storeName = srcdb.objectStoreNames[i];
              var store = trans.objectStore(storeName);
              var objfinalizer = Utils.async.generator(function(err) {
                cb && cb(err);
              });
              var objdone = objfinalizer();
              var curreq = store.openCursor(undefined, 'next');
              curreq.onsuccess = function(ev) {
                var cursor = curreq.result;
                if (cursor) {
                  var outgoing = objfinalizer();
                  var key = cursor.key;
                  var getreq = store.get(key);
                  getreq.onsuccess = function(ev) {
                    var value = getreq.result;
                    putKV(storeName, key, value, function(err) {
                      outgoing(err);
                    });
                    cursor.continue();
                  };
                  getreq.onerror = function(ev) {
                    cb && cb(getreq.error);
                  };
                } else {
                  objdone();
                }
              };
              curreq.onerror = function(ev) {
                callback && callback(curreq.error);
              };
            })(i, gen());
          }
          done();
        }).bind(this);
        srcreq.onblocked = srcreq.onupgradeneeded = srcreq.onerror =
          function(ev) {
          callback && callback(new Error(
            'Error occured while opening old database'));
        };
      }.bind(this));
    },

    // ===========================================================
    // Database initializing and upgrading

    loadSchemas: function(callback) {
      /**
       * loadSchemas @private
       *
       * @param {function} callback - called after all
       *                              schemas are loaded.
       *
       * Lazily loads schemas and then calls the callback.
       * SchemaVersions that were defined with a different
       * databaseName must be loaded manually.
       */
      LazyLoader.load(this.schemas, function() {
        SchemaVersion.getSchemaVersions(this.name).forEach(
          function(el) {
          el.register(this);
        }.bind(this));
        callback && callback();
      }.bind(this));
    },

    initialize: function(newVersion, callback) {
      /**
       * initialize @private
       *
       * @param {number} newVersion - integer effective version.
       * @param {function} callback - function to be called after
       *                              the database is initialized.
       */
      this.requestMutatorTransaction(function(err, transaction) {
        var db = transaction.db;
        var objectStores = db.objectStoreNames;
        for (var i = 0; i < objectStores.length; i++) {
          db.deleteObjectStore(objectStores[i]);
        }
        var init = Utils.data.binarySearch({ 'version': newVersion },
          this.initializers,
          Utils.data.keyedCompare('version'));
        if (init.match) {
          var setVersion = (function(err) {
            db.close();
            this.setLatestVersion(this.name, newVersion, callback);
          }).bind(this);
          this.initializers[init.index].fn(transaction, setVersion);
        } else {
          callback && callback(new Error('no initializer for ' + newVersion));
        }
      }.bind(this));
    },

    requestMutatorTransaction: function(callback) {
      /**
       * requestMutatorTransaction @private
       *
       * @param {function} callback - function to be called with the
       *                              versionchange transaction.
       */
      this.getLatestVersion(this.name, function(err, version, effective) {
        var req = indexedDB.open(this.name, version + 1);
        req.onupgradeneeded = function(ev) {
          req.result.onversionchange = function(ev) {
            req.result.close();
          };
          callback && callback(null, ev.target.transaction, req);
        };
        req.onerror = function(ev) {
          callback && callback(req.error);
        };
      }.bind(this));
    },

    upgrade: function(oldVersion, newVersion, callback) {
      /**
       * upgrade @private
       *
       * @param {IDBTransaction} transaction - versionchanged transaction.
       * @param {number} oldVersion - integer old effective version.
       * @param {number} newVersion - integer effective version.
       * @param {function} callback - function to be called after
       *                              the database is upgraded.
       *
       * Attempt to upgrade the database. If the upgrade fails, or if
       * there is no upgrade path defined, we default to destroying the
       * existing database and initializing a new one of this.version.
       */
      var mutators, direction;
      if (newVersion === oldVersion) {
        return;
      } else if (newVersion > oldVersion) {
        mutators = this.upgraders;
        direction = 1;
      } else {
        mutators = this.downgraders;
        direction = -1;
      }
      var first = Utils.data.binarySearch({version: oldVersion}, mutators,
        Utils.data.keyedCompare('version'));
      var plan = [], last = null;
      if (first.match) {
        var isApplicableMutator = function(m, dir, version) {
          // don't upgrade past the target
          if (dir === 1) {
            return m.version < version;
          } else {
            return m.version > version;
          }
        };
        for (var i = first.index;
             i >= 0 && i < mutators.length &&
               isApplicableMutator(mutators[i], direction, newVersion);
             i += direction) {
          // If our version numbers have a gap larger than 1, we
          // cannot fluidly upgrade or downgrade. Truncate the
          // plan and continue (forcing an initialize).
          if (last && Math.abs(last - mutators[i].version) > 1) {
            plan.length = 0;
            break;
          }
          plan.push(mutators[i]);
          last = mutators[i].version;
        }
      }
      if (plan.length === 0) {
        this.initialize(newVersion, function(err) {
          callback && callback(err);
        });
        return;
      }
      var finalizer = (function(err) {
        if (!err) {
          this.setLatestVersion(this.name, newVersion, function(err) {
            callback && callback(err);
          });
        } else {
          console.log('Upgrade error:', err.message, err.fileName,
            err.lineNumber);
          // We can't do anything useful here, so start from scratch,
          // destroying user data
          this.initialize(newVersion, function(err) {
            callback && callback(err);
          });
        }
      }).bind(this);
      var last = finalizer;
      for (var i = plan.length - 1; i >= 0; i--) {
        last = (function(converter, version, cb) {
          // de-duplicate the callbacks
          var dedup = Utils.async.namedParallel(['converter'], cb);
          return (function(passedErr) {
            if (passedErr) {
              cb(passedErr);
              return;
            }
            this.requestMutatorTransaction(function(err, transaction) {
              try {
                converter.call(transaction, transaction, dedup.converter);
              } catch (err) {
                dedup.converter(err);
              } finally {
                transaction.db.close();
              }
            });
          }).bind(this);
        }.bind(this))(plan[i].fn, plan[i].version, last);
      }
      last(null);
    },

    connect: function(callback) {
      /**
       * connect
       *
       * @param {function} callback - function to be called after
       *                              the database connection is
       *                              created. Called with (err,
       *                              database).
       *
       * This is the primary API for the database object. Most
       * other methods on Database are not relevant in typical usage.
       */
      var opener = (function(actualVersion) {
        var req = indexedDB.open(this.name, actualVersion);
        req.onsuccess = function(event) {
          req.result.onversionchange = function(event) {
            req.result.close();
          };
          callback && callback(null, req.result);
        };
        req.onerror = (function(event) {
          event.preventDefault();
          callback && callback(req.error);
        }).bind(this);
        req.onblocked = function(event) {
          callback && callback(new Error('blocked'));
        };
      }).bind(this);
      var loadAndUpgrade = function(err, version, effective) {
        this.loadSchemas(function() {
          // We have lazy loaded schema files, now upgrade the database
          this.upgrade(effective, this.version, function(err) {
            if (err) {
              callback && callback(err);
              return;
            }
            // The upgrade function has changed our version number,
            // get the latest
            this.getLatestVersion(this.name,
              function(err, version, effective) {
              opener.call(this, version);
            }.bind(this));
          }.bind(this));
        }.bind(this));
      };
      this.getLatestVersion(this.name, function(err, version, effective) {
        if (version === 0 || effective !== this.version) {
          if (version >= Math.pow(2, 53) - 1) {
            this.doubleCopyReset(
              loadAndUpgrade.bind(this, err, version, effective));
          } else {
            loadAndUpgrade.call(this, err, version, effective);
          }
        } else {
          // No upgrade necessary, just open a connection
          opener.call(this, version);
        }
      }.bind(this));
    }
  };

  return {
    SchemaVersion: SchemaVersion,
    Database: Database
  };
});
