define(['utils', 'database'], function(Utils, db) {
  'use strict';

  var Database = db.Database;
  var SchemaVersion = db.SchemaVersion;

  Utils.debug('inside schema_1.js');

  function convertLegacyAlarm(alarm) {
    /**
     * convertLegacyAlarm
     *
     * Conversions performed:
     *   { repeat: '1100000' } -> { repeat: { monday: true, tuesday: true } }
     *   { normalAlarmId: x,
     *     snoozeAlarmId: y } -> { registeredAlarms: { normal: x, snooze: y }
     */
    if (alarm && typeof alarm.repeat === 'string') {
      var rep = {};
      for (var i = 0; i < alarm.repeat.length; i++) {
        if (alarm.repeat[i] === '1') {
          rep[DAYS[i]] = true;
        }
      }
      alarm.repeat = rep;
    }
    if (alarm &&
          (typeof alarm.normalAlarmId !== 'undefined' ||
           typeof alarm.snoozeAlarmId !== 'undefined')) {
      var tmp = {};
      tmp.normal = alarm.normalAlarmId;
      tmp.snooze = alarm.snoozeAlarmId;
      alarm.registeredAlarms = tmp;
      delete alarm.normalAlarmId;
      delete alarm.snoozeAlarmId;
    }
    return alarm;
  }

  Utils.debug('inside schema_1.js 43');

  function recoverOldData(callback) {
    /**
     * recoverOldData
     *
     * In FirefoxOS 1.0 and 1.1, the database was named 'alarms', and only
     * contained one object store. In 1.2 we're renaming the database to
     * 'clock-app'. This function detects existing 1.0 or 1.1 databases
     * and recovers the alarms stored there. If successful, the old data
     * is deleted.
     *
     * @param {function} callback - called with (null) or (error).
     */
    var req;
    try {
      req = indexedDB.open('alarms', 5);
    } catch (err) {
      callback && callback(err);
      return;
    }
    req.onsuccess = function(ev) {
      var conn = req.result;
      var trans = conn.transaction('alarms', 'readonly');
      var store = trans.objectStore('alarms');
      var curreq = trans.cursor(undefined, 'next');
      curreq.onsuccess = function(ev) {
        var cursor = curreq.result;
        if (cursor) {
          var getreq = conn.get(cursor.key);
          getreq.onsuccess = function(ev) {
            var value = getreq.result;
            var alarm = new Alarm(convertLegacyAlarm(value));
            alarm.save(function(err, alarm) {
              if (!err) {
                cursor.continue();
              } else {
                callback && callback(getreq.error);
              }
            });
          };
          getreq.onerror = function(ev) {
            callback && callback(getreq.error);
          };
        } else {
          // done
          callback && callback(null);
        }
      };
    };
    req.onupgradeneeded = req.onerror = function(ev) {
      ev.preventDefault();
      if (ev.target.transaction) {
        ev.target.transaction.abort();
      }
      // if we're upgrading or an error occurred, don't do anything
      callback && callback(null);
    };
  }

  Utils.debug('inside schema_1.js 103');

  var sv = new SchemaVersion('clock-app', 1, {
    'initializer': function(transaction, callback) {
      var db = transaction.db;
      var err = null;
      try {
        // Serialized Alarm from alarm.js
        var alarms = db.createObjectStore('alarms', {
          keyPath: 'id', autoIncrement: true
        });
        // Serialized Timer from timer.js
        var timers = db.createObjectStore('timers', {
          keyPath: 'id', autoIncrement: true
        });
        // Serialized Stopwatch from stopwatch.js
        var stopwatch = db.createObjectStore('stopwatches', {
          keyPath: 'id', autoIncrement: true
        });
      } catch (e) {
        err = e;
      } finally {
        transaction.db.close();
      }
      if (!err) {
        recoverOldData(callback);
      } else {
        Utils.debug('error in schema', err, err.message);
        callback && callback(err);
      }
    }
  });
  Utils.debug('inside schema_1.js 135', sv);
});
