'use strict';

var SimManager = {
  // XXX: For handling the intermediate 'networkLocked' after unlock
  //      the SIM card.
  _unlocked: false,

  init: function sm_init() {
    this.mobConn = window.navigator.mozMobileConnections;
    if (!this.mobConn) {
      return;
    }

    this.iccManager = window.navigator.mozIccManager;
    if (!this.iccManager) {
      return;
    }

    // keep track of sim card info in slot 0 and 1
    this.icc0 = null;
    this.icc1 = null;

    if (this.iccManager.iccIds[0]) {
      this.updateIccState(this.iccManager.iccIds[0]);
    }
    if (this.iccManager.iccIds[1]) {
      this.updateIccState(this.iccManager.iccIds[1]);
    }

    this.iccManager.addEventListener('iccdetected',
                                     this.handleIccDetected.bind(this));

    _ = navigator.mozL10n.get;

    this.alreadyImported = false;
  },

  handleUnlockError: function sm_handleUnlockError(data) {
    var l10nArgs = {n: data.retryCount};
    switch (data.lockType) {
      case 'pin':
        UIManager.pinInput.value = '';
        UIManager.pinInput.classList.add('onerror');
        UIManager.pinError.textContent = _('pinError');
        UIManager.pinError.classList.remove('hidden');
        UIManager.pinError.textContent = _('pinAttemptMsg2', l10nArgs);
        UIManager.pinRetriesLeft.textContent = _('inputCodeRetriesLeft',
                                                 l10nArgs);
        if (data.retryCount == 1) {
          UIManager.pinError.textContent += ' ' + _('pinLastChanceMsg');
        }
        break;
      case 'puk':
        UIManager.pukInput.value = '';
        UIManager.pukInput.classList.add('onerror');
        UIManager.pukError.textContent = _('pukError');
        UIManager.pukError.classList.remove('hidden');
        UIManager.pukInfo.classList.add('hidden');
        UIManager.pukError.textContent = _('pukAttemptMsg2', l10nArgs);
        UIManager.pukRetriesLeft.textContent = _('inputCodeRetriesLeft',
                                                 l10nArgs);
        if (data.retryCount == 1) {
          UIManager.pukError.textContent += _('pukLastChanceMsg');
        }
        // TODO what if counter gets to 0 ??
        break;
      case 'nck':
      case 'cck':
      case 'spck':
        UIManager.xckInput.value = '';
        UIManager.xckInput.classList.add('onerror');
        UIManager.xckError.textContent = _('nckError');
        UIManager.xckError.classList.remove('hidden');
        UIManager.xckInfo.classList.add('hidden');
        UIManager.xckError.textContent = _('nckAttemptMsg2', l10nArgs);
        UIManager.xckRetriesLeft.textContent = _('inputCodeRetriesLeft',
                                                 l10nArgs);
        if (data.retryCount == 1) {
          UIManager.xckError.textContent += _('nckLastChanceMsg');
        }
        break;
    }
  },

  available: function sm_available() {
    return (this.icc0 && this.icc0.cardState === 'ready');
  },

  handleIccDetected: function sm_handleIccDetected(event) {
    this.updateIccState(event.iccId);
  },

  updateIccState: function(iccId) {
    var iccInfo = this.iccManager.getIccById(iccId);
    if (!iccInfo) {
      throw new Error('Unrecognized iccID: ' + iccId);
    }

    // determine SIM slot number
    if (this.mobConn[0] && iccId === this.mobConn[0].iccId) {
      this.icc0 = iccInfo;
    } else if (this.mobConn[1] && iccId === this.mobConn[1].iccId) {
      this.icc1 = iccInfo;
    } else {
      throw new Error('ICC detected in unrecognized slot: ' + iccId);
    }

    iccInfo.addEventListener('cardstatechange',
                             this.handleCardState.bind(this));
  },

 /*
  * Possible values:
  *   null,
  *   'unknown',
  *   'pinRequired',
  *   'pukRequired',
  *   'networkLocked',
  *   'corporateLocked',
  *   'serviceProviderLocked',
  *   'ready'.
  */
  handleCardState: function sm_handleCardState(callback) {
    // XXX: for now we only care about SIM in slot0
    // this will be changed for dual sim support
    if (!this.icc0) {
      return;
    }

    SimManager.checkSIMButton();
    this.accessCallback = (typeof callback === 'function') ? callback : null;
    switch (this.icc0.cardState) {
      case 'pinRequired':
        this.showPinScreen();
        break;
      case 'pukRequired':
        this.showPukScreen();
        break;
      case 'networkLocked':
      case 'corporateLocked':
      case 'serviceProviderLocked':
        this.showXckScreen();
        break;
      default:
        if (this.accessCallback) {
          this.accessCallback(this.icc0.cardState === 'ready');
        }
        break;
    }
  },

  checkSIMButton: function sm_checkSIMButton() {
    if (!this.mobConn) {
      UIManager.simImport.classList.add('hidden');
      return;
    }

    var simOption = UIManager.simImportButton;
    // If there is an unlocked SIM we activate import from SIM
    if (!SimManager.alreadyImported && SimManager.available()) {
      simOption.removeAttribute('disabled');
      UIManager.noSim.classList.add('hidden');
    } else {
      simOption.setAttribute('disabled', 'disabled');
      if (!SimManager.alreadyImported) {
        UIManager.noSim.classList.remove('hidden');
      }
    }
  },

  showPinScreen: function sm_showPinScreen() {
    if (this._unlocked) {
      return;
    }

    this.icc0.getCardLockRetryCount('pin', function(retryCount) {
      if (retryCount) {
        var l10nArgs = {n: retryCount};
        UIManager.pinRetriesLeft.textContent = _('inputCodeRetriesLeft',
                                                 l10nArgs);
        UIManager.pinRetriesLeft.classList.remove('hidden');
      }
    });
    // Button management
    UIManager.unlockSimButton.disabled = true;
    UIManager.pinInput.addEventListener('input', function sm_checkInput(event) {
      UIManager.unlockSimButton.disabled = (event.target.value.length < 4);
    });
    // Screen management
    UIManager.activationScreen.classList.remove('show');
    UIManager.unlockSimScreen.classList.add('show');
    UIManager.pincodeScreen.classList.add('show');
    UIManager.xckcodeScreen.classList.remove('show');
    UIManager.pinInput.focus();
  },

  showPukScreen: function sm_showPukScreen() {
    if (this._unlocked) {
      return;
    }

    this.icc0.getCardLockRetryCount('puk', function(retryCount) {
      if (retryCount) {
        var l10nArgs = {n: retryCount};
        UIManager.pukRetriesLeft.textContent = _('inputCodeRetriesLeft',
                                                 l10nArgs);
        UIManager.pukRetriesLeft.classList.remove('hidden');
      }
    });

    UIManager.unlockSimScreen.classList.add('show');
    UIManager.activationScreen.classList.remove('show');
    UIManager.pincodeScreen.classList.remove('show');
    UIManager.pukcodeScreen.classList.add('show');
    UIManager.xckcodeScreen.classList.remove('show');
    UIManager.unlockSimHeader.textContent = _('pukcode');
    UIManager.pukInput.focus();
  },

  showXckScreen: function sm_showXckScreen() {
    if (this._unlocked) {
      return;
    }

    var lockType;

    switch (this.icc0.cardState) {
      case 'networkLocked':
        lockType = 'nck';
        break;
      case 'corporateLocked':
        lockType = 'cck';
        break;
      case 'serviceProviderLocked':
        lockType = 'spck';
        break;
      default:
        return; // We shouldn't be here.
    }

    this.icc0.getCardLockRetryCount(lockType, function(retryCount) {
      if (retryCount) {
        var l10nArgs = {n: retryCount};
        UIManager.xckRetriesLeft.textContent = _('inputCodeRetriesLeft',
                                                 l10nArgs);
        UIManager.xckRetriesLeft.classList.remove('hidden');
      }
    });

    UIManager.unlockSimScreen.classList.add('show');
    UIManager.activationScreen.classList.remove('show');
    UIManager.pincodeScreen.classList.remove('show');
    UIManager.pukcodeScreen.classList.remove('show');
    UIManager.xckcodeScreen.classList.add('show');

    switch (this.icc0.cardState) {
      case 'networkLocked':
        UIManager.unlockSimHeader.textContent = _('nckcode');
        UIManager.xckLabel.textContent = _('type_nck');
        break;
      case 'corporateLocked':
        UIManager.unlockSimHeader.textContent = _('cckcode');
        UIManager.xckLabel.textContent = _('type_cck');
        break;
      case 'serviceProviderLocked':
        UIManager.unlockSimHeader.textContent = _('spckcode');
        UIManager.xckLabel.textContent = _('type_spck');
        break;
    }
    UIManager.xckInput.focus();
  },

  hideScreen: function sm_hideScreen() {
    UIManager.unlockSimScreen.classList.remove('show');
    UIManager.pincodeScreen.classList.remove('show');
    UIManager.pukcodeScreen.classList.remove('show');
    UIManager.xckcodeScreen.classList.remove('show');
    UIManager.activationScreen.classList.add('show');
  },

  skip: function sm_skip() {
    this.hideScreen();
    if (this.accessCallback) {
      this.accessCallback(false);
    }
  },

  back: function sm_back() {
    this.hideScreen();
    Navigation.back();
  },

  unlock: function sm_unlock() {
    this._unlocked = false;

    switch (this.icc0.cardState) {
      case 'pinRequired':
        this.unlockPin();
        break;
      case 'pukRequired':
        this.unlockPuk();
        break;
      case 'networkLocked':
      case 'corporateLocked':
      case 'serviceProviderLocked':
        this.unlockXck();
        break;
    }
  },

  unlockPin: function sm_unlockPin() {
    var pin = UIManager.pinInput.value;
    if (pin.length < 4 || pin.length > 8) {
      UIManager.pinError.textContent = _('pinValidation');
      UIManager.pinInput.classList.add('onerror');
      UIManager.pinError.classList.remove('hidden');
      UIManager.pinInput.focus();
      return;
    } else {
      UIManager.pinInput.classList.remove('onerror');
      UIManager.pinError.classList.add('hidden');
    }

    // Unlock SIM
    var options = {lockType: 'pin', pin: pin };
    var req = this.icc0.unlockCardLock(options);
    req.onsuccess = (function sm_unlockSuccess() {
      this._unlocked = true;
      this.hideScreen();
    }).bind(this);
    req.onerror = (function sm_unlockError() {
      this.handleUnlockError(req.error);
    }).bind(this);
  },

  clearFields: function sm_clearFields() {
    UIManager.pukInput.classList.remove('onerror');
    UIManager.pukError.classList.add('hidden');

    UIManager.newpinInput.classList.remove('onerror');
    UIManager.newpinError.classList.add('hidden');

    UIManager.confirmNewpinInput.classList.remove('onerror');
    UIManager.confirmNewpinError.classList.add('hidden');
  },

  unlockPuk: function sm_unlockPuk() {
    this.clearFields();
    var pukCode = UIManager.pukInput.value;
    if (pukCode.length !== 8) {
      UIManager.pukError.textContent = _('pukValidation');
      UIManager.pukError.classList.remove('hidden');
      UIManager.pukInfo.classList.add('hidden');
      UIManager.pukInput.classList.add('onerror');
      UIManager.pukError.focus();
      return;
    }
    var newpinCode = UIManager.newpinInput.value;
    var confirmNewpin = UIManager.confirmNewpinInput.value;
    if (newpinCode.length < 4 || newpinCode.length > 8) {
      UIManager.newpinError.textContent = _('pinValidation');
      UIManager.newpinError.classList.remove('hidden');
      UIManager.newpinInput.classList.add('onerror');
      UIManager.newpinError.focus();
      return;
    }
    if (newpinCode != confirmNewpin) {
      UIManager.confirmNewpinError.textContent = _('newpinConfirmation');
      UIManager.confirmNewpinError.classList.remove('hidden');
      UIManager.newpinInput.classList.add('onerror');
      UIManager.confirmNewpinInput.classList.add('onerror');
      UIManager.confirmNewpinError.focus();
      return;
    }

    // Unlock SIM with PUK and new PIN
    var options = {lockType: 'puk', puk: pukCode, newPin: newpinCode };
    var req = this.icc0.unlockCardLock(options);
    req.onsuccess = (function sm_unlockSuccess() {
      this._unlocked = true;
      this.hideScreen();
    }).bind(this);
  },

  unlockXck: function sm_unlockXck() {
    var xck = UIManager.xckInput.value;
    var lockType;
    switch (this.icc0.cardState) {
      case 'networkLocked':
        lockType = 'nck';
        break;
      case 'corporateLocked':
        lockType = 'cck';
        break;
      case 'serviceProviderLocked':
        lockType = 'spck';
        break;
    }
    if (xck.length < 8 || xck.length > 16) {
      UIManager.xckInput.classList.add('onerror');
      UIManager.xckError.classList.remove('hidden');
      UIManager.xckError.textContent = _(lockType + 'Validation');
      UIManager.xckInput.focus();
      return;
    } else {
      UIManager.pinInput.classList.remove('onerror');
      UIManager.pinError.classList.add('hidden');
    }

    // Unlock SIM
    var options = {lockType: lockType, pin: xck };
    var req = this.icc0.unlockCardLock(options);
    req.onsuccess = (function sm_unlockSuccess() {
      this._unlocked = true;
      this.hideScreen();
    }).bind(this);
  },

  // Try to infer whats the default SIM
  guessIcc: function guessIcc() {
    var tempIcc = null;
    if (navigator.mozMobileConnections) {
      // New multi-sim api, use mozMobileConnection to guess
      // the first inserted sim
      for (var i = 0;
        i < navigator.mozMobileConnections.length && tempIcc === null; i++) {
        if (navigator.mozMobileConnections[i] !== null &&
          navigator.mozMobileConnections[i].iccId !== null) {
          tempIcc = navigator.mozIccManager.getIccById(
            navigator.mozMobileConnections[i].iccId);
        }
      }
    } else {
      tempIcc = navigator.mozIccManager;
    }

    return tempIcc;
  },

  importContacts: function sm_importContacts() {
    // Delay for showing feedback to the user after importing
    var DELAY_FEEDBACK = 300;
    UIManager.navBar.setAttribute('aria-disabled', 'true');
    var progress = utils.overlay.show(_('simContacts-reading'),
                                      'activityBar');

    var importButton = UIManager.simImportButton;
    var cancelled = false,
        contactsRead = false;
    var importer = new SimContactsImporter(SimManager.guessIcc());
    utils.overlay.showMenu();
    utils.overlay.oncancel = function oncancel() {
      cancelled = true;
      importer.finish();
      if (contactsRead) {
        // A message about canceling will be displayed while the current chunk
        // is being cooked
        progress.setClass('activityBar');
        utils.overlay.hideMenu();
        progress.setHeaderMsg(_('messageCanceling'));
      } else {
        importer.onfinish(); // Early return while reading contacts
      }
    };
    var importedContacts = 0;

    importer.onread = function sim_import_read(n) {
      contactsRead = true;
      if (n > 0) {
        progress.setClass('progressBar');
        progress.setHeaderMsg(_('simContacts-importing'));
        progress.setTotal(n);
      }
    };

    importer.onimported = function imported_contact() {
      importedContacts++;
      if (!cancelled) {
        progress.update();
      }
    };

    importer.onfinish = function sim_import_finish() {
      window.setTimeout(function do_sim_import_finish() {
        UIManager.navBar.removeAttribute('aria-disabled');
        utils.overlay.hide();
        if (importedContacts > 0) {
          window.importUtils.setTimestamp('sim');
        }
        if (!cancelled) {
          SimManager.alreadyImported = true;
          importButton.setAttribute('disabled', 'disabled');
          utils.status.show(_('simContacts-imported3',
                              {n: importedContacts})
          );
        }
      }, DELAY_FEEDBACK);

      importer.onfinish = null;
    };

    importer.onerror = function sim_import_error() {
      UIManager.navBar.removeAttribute('aria-disabled');
      utils.overlay.hide();
      // Just in case the user decides to do so later
      importButton.removeAttribute('disabled');

      // Showing error message allowing user to retry
      var cancel = {
        title: _('cancel'),
        callback: function() {
          ConfirmDialog.hide();
        }
      };
      var retry = {
        title: _('retry'),
        isRecommend: true,
        callback: function() {
          ConfirmDialog.hide();
          // And now the action is reproduced one more time
          importButton.click();
        }
      };
      ConfirmDialog.show(null, _('simContacts-error'), cancel, retry);
    }; // importer.onerror

    importer.start();
  }
};
