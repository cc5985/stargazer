/* global angular, console, sjcl, StellarSdk */

angular.module('app')
.factory('Keychain', function ($q, $rootScope, Modal, Storage) {
	'use strict';

	function encryptSeed(seed, key, cipherName, modeName) {
		var cipher = new sjcl.cipher[cipherName](key);
		var rawIV = sjcl.random.randomWords(3);
		var encryptedData = sjcl.mode[modeName].encrypt(
			cipher,
			sjcl.codec.utf8String.toBits(seed),
			rawIV
		);

		return [
			sjcl.codec.base64.fromBits(rawIV),
			sjcl.codec.base64.fromBits(encryptedData)
		];
	}

	function encrypt(seed, password) {

		var saltBits = sjcl.random.randomWords(4);		//	128 bits of salt, was 256 bits
		var numRounds = 4096;
		var key = sjcl.misc.pbkdf2(password, saltBits, numRounds);

		var salt = sjcl.codec.base64.fromBits(saltBits);

		var cipherName = 'aes';
		var modeName = 'gcm';

		var blob = encryptSeed(seed, key, cipherName, modeName);
		return ['1', salt, blob];
	}

	function decryptSeed(blob, key) {
		var cipherName = 'aes';
		var modeName = 'gcm';

		var cipher = new sjcl.cipher[cipherName](key);
		var rawIV = sjcl.codec.base64.toBits(blob[0]);
		var rawCipherText = sjcl.codec.base64.toBits(blob[1]);
		var decryptedData = sjcl.mode[modeName].decrypt(
			cipher,
			rawCipherText,
			rawIV
		);

		return sjcl.codec.utf8String.fromBits(decryptedData);
	}

	function decrypt(data, password) {
		var saltBits = sjcl.codec.base64.toBits(data[1]);
		var numRounds = 4096;
		var key = sjcl.misc.pbkdf2(password, saltBits, numRounds);
		return decryptSeed(data[2], key);
	}

	/* */

	function getKey(signer) {

		var keyStore = keychain[signer];
		if (typeof keyStore === 'string') {
			var keys =  StellarSdk.Keypair.fromSeed(keyStore);
			return $q.when(keys);
		}

		var scope = $rootScope.$new();
		scope.signer = signer;

		return Modal.show('app/default/modals/submit-password.html', scope)
		.then(function (password) {
			var seed = decrypt(keyStore, password);
			return StellarSdk.Keypair.fromSeed(seed);
		}, function (err) {
			return $q.reject(err);
		});
	}

	/* */

	var keychain = {};
	var keys = Storage.getItem('keys');
	if (keys) {
		keys.forEach(function (publicKey) {
			keychain[publicKey] = Storage.getItem('key.' + publicKey);
		});
	}

	/* */

	return {

		decrypt: decrypt,

		setPassword: function (signer, password) {
			var keyStore = keychain[signer];
			keyStore = encrypt(keyStore, password);
			keychain[signer] = keyStore;
			Storage.setItem('key.' + signer, keyStore);
		},

		removePassword: function (signer, password) {
			var keyStore = keychain[signer];
			keyStore = decrypt(keyStore, password);
			keychain[signer] = keyStore;
			Storage.setItem('key.' + signer, keyStore);
		},

		addKey: function (accountId, seed) {
			keychain[accountId] = seed;
			Storage.setItem('key.' + accountId, seed);
			Storage.setItem('keys', Object.keys(keychain));
		},

		getKeyInfo: function (signer) {
			return keychain[signer];
		},

		signMessage: function (signer, message) {
			return getKey(signer)
			.then(function (key) {
				var hash = StellarSdk.hash(message);
				return key.sign(hash).toString('base64');
			});
		},

		signTransaction: function (signer, tx, txHash) {
			return getKey(signer)
			.then(
				function (key) {
					var sig = key.signDecorated(txHash);
					tx.signatures.push(sig);
				},
				function (err) {
					return $q.reject(err);
				}
			);
		},

		isValidPassword: function (signer, password) {
			var keyStore = keychain[signer];
			if (typeof keyStore === 'string') {
				return true;
			}

			var seed = decrypt(keyStore, password);
			try {
				var keypair = StellarSdk.Keypair.fromSeed(seed);
				return true;
			} catch (error) {
				return false;
			}
		},

		isEncrypted: function (signer) {
			return (typeof keychain[signer] === 'object');
		},

		isLocalSigner: function (signer) {
			return (signer in keychain);
		}
	};
});
