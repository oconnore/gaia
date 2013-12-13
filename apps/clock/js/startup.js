define('startup_init', function(require) {
'use strict';

var Constants = require('constants');
var Database = require('database').Database;
var App = require('app');
var ClockView = require('clock_view');
var AlarmList = require('alarm_list');
var ActiveAlarm = require('active_alarm');
var mozL10n = require('l10n');
var testReq = require;

// eventually after some refactoring, this should be replaced with
// App.init.bind(App)
function initialize() {

  Database.singleton(Constants.DB_OPTIONS);

  // after all the needed files have been loaded
  // and l10n has happened this will be called
  App.init();

  // all three of these should disappear as we refactor
  ClockView.init();
  AlarmList.init();
  ActiveAlarm.singleton().init();
}

mozL10n.ready(initialize);
});

require(['require_config'], function() {
  requirejs(['startup_init']);
});
