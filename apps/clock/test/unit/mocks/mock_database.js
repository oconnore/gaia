define(function(require, exports) {
  'use strict';

  var Utils = require('utils');

  /*
   * Mock some simple database operations
   */

  function MockDatabase() {
    this.stores = new Map();
    this.meta = new Map();
  }

  var databaseSingletons = new Map();

  MockDatabase.singleton = function(options) {
    var db = databaseSingletons.get(options.name);
    if (!db) {
      db = new MockDatabase(options);
      databaseSingletons.set(options.name, db);
    }
    return db;
  };

  MockDatabase.prototype = {

    mockClear: function(options) {
      /**
       * mockClear - wipe the mocked database.
       *
       * @param {object} [options] - options object containing:
       *                 data: {boolean} - wipe data from object stores.
       *                 stores: {boolean} - wipe object stores.
       */
      if (options && options.stores === true) {
        this.stores = new Map();
        this.meta = new Map();
      }
      if (!options || options.data === true) {
        for (var st of this.stores) {
          var key = st[0], val = st[1];
          this.stores.set(key, new Map());
        }
      }
    },

    createObjectStore: function(name, options) {
      /**
       * createObjectStore
       *
       * Create a mocked object store.
       *
       * @param {string} name - Name of the object store.
       * @param {object} [options] - options contains the following possible
       *        parameters: [keyPath, autoincrement, id]. These have similar
       *        behavior as in indexedDB: keyPath sets the property to be
       *        used as a key, autoincrement defines whether the key is
       *        generated when undefined, and id represents a counter
       *        implementing the autoincrement generator.
       */
      var storeMap = new Map();
      this.stores.set(name, storeMap);
      if (typeof options !== 'undefined') {
        var tmp = Utils.extend({}, options);
        if (tmp.autoincrement === true &&
            typeof tmp.id !== 'number') {
          tmp.id = 1;
        }
        this.meta.set(name, tmp);
      } else {
        this.meta.set(name, { keyPath: null, autoincrement: false });
      }
    },

    alist: function(objectStore, iter, callback) {
      if (arguments.length === 2 && typeof arguments[1] === 'function') {
        callback = arguments[1];
        iter = 'next';
      }
      if (!this.stores.has(objectStore)) {
        callback && callback(new Error('no objectstore'));
        return;
      }
      var collect = [];
      for (var i of this.stores.get(objectStore)) {
        collect.push(i);
      }
      setTimeout(function() {
        callback && callback(null, collect.sort(function(a, b) {
          if (iter === 'prev') {
            return b[0] - a[0];
          } else {
            return a[0] - b[0];
          }
        }));
      }, 0);
    },

    put: function(objectStore, value, key, callback) {
      var store = this.stores.get(objectStore);
      var meta = this.meta.get(objectStore);
      if (!store || !meta) {
        callback && callback(new Error('no objectstore'));
        return;
      }
      if (arguments.length === 3 && typeof arguments[2] === 'function') {
        callback = arguments[2];
        key = undefined;
      }
      if (typeof key === 'undefined') {
        if (typeof meta.keyPath === 'string' &&
            typeof value[meta.keyPath] !== 'undefined') {
          key = value[meta.keyPath];
        } else if (meta.autoincrement === true) {
          key = meta.id++;
          if (typeof meta.keyPath === 'string') {
            value[meta.keyPath] = key;
          }
        } else {
          callback && callback(new Error('no key supplied'));
          return;
        }
      }
      store.set(key, value);
      setTimeout(function() {
        callback && callback(null, value);
      }, 0);
    },

    request: function(objectStore, key, callback) {
      var store = this.stores.get(objectStore);
      if (!store) {
        callback && callback(new Error('no objectstore'));
      }
      if (store.has(key)) {
        setTimeout(function() {
          callback(null, store.get(key));
        }.bind(this), 0);
      } else {
        setTimeout(function() {
          callback && callback(new Error('key not found ' + key));
        }.bind(this), 0);
      }
    },

    delete: function(objectStore, key, callback) {
      var store = this.stores.get(objectStore);
      if (!store) {
        callback && callback(new Error('no objectstore'));
      }
      console.log('called delete', JSON.stringify(key));
      store.delete(key);
      setTimeout(function() {
        callback && callback(null);
      }.bind(this), 0);
    }

  };

  exports.Database = MockDatabase;

});
