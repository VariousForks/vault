/*
 * Copyright (C) 2016 True Holding Ltd.
 * 
 * Commercial License Usage
 * 
 * Licensees holding valid commercial Zipper licenses may use this file in
 * accordance with the terms contained in written agreement between you and
 * True Holding Ltd.
 * 
 * GNU Affero General Public License Usage
 * 
 * Alternatively, the JavaScript code in this page is free software: you can 
 * redistribute it and/or modify it under the terms of the GNU Affero General Public
 * License (GNU AGPL) as published by the Free Software Foundation, either
 * version 3 of the License, or (at your option) any later version.  The code
 * is distributed WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU AGPL for
 * more details.
 * 
 * As additional permission under GNU AGPL version 3 section 7, you may
 * distribute non-source (e.g., minimized or compacted) forms of that code
 * without the copy of the GNU GPL normally required by section 4, provided
 * you include this license notice and a URL through which recipients can
 * access the Corresponding Source.
 * 
 * As a special exception to the AGPL, any HTML file which merely makes
 * function calls to this code, and for that purpose includes it by reference
 * shall be deemed a separate work for copyright law purposes.  In addition,
 * the copyright holders of this code give you permission to combine this
 * code with free software libraries that are released under the GNU LGPL.
 * You may copy and distribute such a system following the terms of the GNU
 * AGPL for this code and the LGPL for the libraries.  If you modify this
 * code, you may extend this exception to your version of the code, but you
 * are not obligated to do so.  If you do not wish to do so, delete this
 * exception statement from your version.
 *  
 * This license applies to this entire compilation.
 */

var hdkey = require('hdkey');
var bip39 = require('bip39');
var store = require('store');
var secp256k1 = require('secp256k1');
var sessionstorage = require('sessionstorage');
var crypto = require('crypto');
var eccrypto = require('eccrypto');
var apporigin = null;
var apphdkey = {};

/* 
 */

function vaultInit(event)
{
     var callback = event.data.callback;
     // do we even have anything in our vault right now?
     // the above will eventually get replaced with forget-me mnenomic fetching
     
     // Add ability to ask for hardened mnemonic for particular apps needing extra security at expense at some processing
          
     if (event.data.init.useOrigin)
     {
         apporigin = event.origin;
     }
     else
     {
        // do we have a cookie?
        // if yes get the right appid and find the relevant keys/etc 
        if (location.hash.startsWith('#Magic='))
        {
            var cookie = location.hash.slice('#Magic='.length);
            apporigin = sessionstorage.getItem('MagicCookie' + cookie); // we can now trust this apporigin
        }
        // if no, instruct parent to redirect to cookie page and return
        else
        {
            parent.postMessage({'callback' : callback, 'result' : 'redirectForCookie', 'url' : 'url'}, event.origin);
            throw 'End of the line';
        }
     }
     
     parent.postMessage({'callback' : callback, 'result' : 'inited'}, event.origin);     
     // should page-relevant stuff in digital self be encrypted with the page app url/id? hashed?
     // does this app already have an identity key? else assign it one and send it to app
              
}

var inited = false;

function getWebseedMnemonic()
{
     if (store.get('vaultSetup') != null && store.get('vaultSetup') == 1)
     {
        console.log("Reseting identity. Webseed is still backed up.");
        store.set('vaultSetup', null);
     }
     if (store.get('vaultSetup') == null)
     {
         console.log("No identity found, create a new mnemonic");
         var mnemonic = bip39.generateMnemonic();
         store.set('mnemonic', mnemonic);
         store.set('vaultSetup', 2); // version number
     }
     return store.get('mnemonic');
}

function handleSecureVaultMessage(event)
{
     if (event.source == parent)
     {
         // are we inited? if so, only accept one message, init
         if ('init' in event.data && !inited)
         {
             vaultInit(event);
             inited = true;
             return;
         }

         if (!inited)
             return;

         if ('getAppID' in event.data)
         {
              var callback = event.data.callback;
              parent.postMessage({'callback' : callback, 'appid' : apporigin}, event.origin);
         }
         else if ('secp256k1SetupPurpose' in event.data)
         {
              var callback = event.data.callback;
              
              var seed2mnemonic = getWebseedMnemonic();
              if (seed2mnemonic == null)
              {
                  parent.postMessage({'callback' : callback, 'result' : 'offline'}, event.origin);
              }

              var seed;
              
              if (event.data.secp256k1SetupPurpose.purpose == 'auto')
                  seed = bip39.mnemonicToSeed(seed2mnemonic, "web:" + apporigin);
              else
                  seed = bip39.mnemonicToSeed(seed2mnemonic, "web:" + apporigin + "purpose" + event.data.secp256k1SetupPurpose.purpose);

              apphdkey[event.data.secp256k1SetupPurpose.alias] = hdkey.fromMasterSeed(seed);
              parent.postMessage({'callback' : callback, 'result' : 'online'}, event.origin);
         }
         // get the ethereum address for a particular sub-account
         else if ('secp256k1KeyInfo' in event.data)
         {
             // key { purpose: 'auto', derive: 'm/0/0' }
             var callback = event.data.callback;
             // we use other children for other things for now
             var ahdkey = apphdkey[event.data.secp256k1KeyInfo.key.purpose].derive(
                  event.data.secp256k1KeyInfo.key.derive);
             var pubkey = secp256k1.publicKeyConvert(ahdkey.publicKey, false);
             // give back SEC1 form
             parent.postMessage({'callback' : callback, 'result' : { 'pubkey' : pubkey.toString('hex'), 'pubex' : ahdkey.publicExtendedKey }}, event.origin);
         }
         else if ('secp256k1Derive' in event.data)
         {
             var callback = event.data.callback;
             // we use other children for other things for now
             var ahdkey = hdkey.fromExtendedKey(event.data.secp256k1Derive.key.pubex).derive(
                  event.data.secp256k1Derive.key.derive);
             var pubkey = secp256k1.publicKeyConvert(ahdkey.publicKey, false);
             // give back SEC1 form
             parent.postMessage({'callback' : callback, 'result' : { 'pubkey' : pubkey.toString('hex'), 'pubex' : ahdkey.publicExtendedKey }}, event.origin);
         }
         else if ('secp256k1Encrypt' in event.data)
         {
             var callback = event.data.callback;
             var ecpub = Buffer.from(event.data.secp256k1Encrypt.pubkey, 'hex');
             var plaintext = Buffer.from(event.data.secp256k1Encrypt.plaintext, 'hex');
             eccrypto.encrypt(ecpub, plaintext).then(function(response) {
                  var rep = { iv: response.iv.toString('hex'), 
                              ephemPublicKey: response.ephemPublicKey.toString('hex'),
                              ciphertext: response.ciphertext.toString('hex'),
                              mac: response.mac.toString('hex') };
                              
                  parent.postMessage({'callback' : callback, 'result' : rep }, event.origin);
             });             
         }
         else if ('secp256k1Decrypt' in event.data)
         {
             var callback = event.data.callback;
             var to = apphdkey[event.data.secp256k1Decrypt.key.purpose].derive(
                  event.data.secp256k1Decrypt.key.derive);
             var ecpriv = to.privateKey;
             var response = { 
               iv: Buffer.from(event.data.secp256k1Decrypt.iv, 'hex'),
               ephemPublicKey: Buffer.from(event.data.secp256k1Decrypt.ephemPublicKey, 'hex'),
               ciphertext: Buffer.from(event.data.secp256k1Decrypt.ciphertext, 'hex'),
               mac: Buffer.from(event.data.secp256k1Decrypt.mac, 'hex')
             };
             eccrypto.decrypt(ecpriv, response).then(function(buf) {
                 parent.postMessage({'callback' : callback, 'result' : buf.toString('hex') }, event.origin);
             });
                                       
         }
         else if ('secp256k1Sign' in event.data)
         {
             var callback = event.data.callback;
             var from = apphdkey[event.data.secp256k1Sign.key.purpose].derive(
                  event.data.secp256k1Sign.key.derive);
             var sig = secp256k1.sign(Buffer.from(event.data.secp256k1Sign.hash, 'hex'), from.privateKey);
             
             parent.postMessage({'callback' : callback, 'result' : { signature: sig.signature.toString('hex'), recovery: sig.recovery, hash: event.data.secp256k1Sign.hash } }, event.origin);
         }
         else if ('secp256k1Recover' in event.data)
         {
             var callback = event.data.callback;
             var signature = Buffer.from(event.data.secp256k1Recover.signature, 'hex');
             var recovery = event.data.secp256k1Recover.recovery;
             var hash = Buffer.from(event.data.secp256k1Recover.hash, 'hex');
             
             var senderPubKey = secp256k1.recover(hash, signature, recovery);
             senderPubKey = secp256k1.publicKeyConvert(senderPubKey, false);

             parent.postMessage({'callback' : callback, 'result' : senderPubKey.toString('hex')}, event.origin);
         }
         else if ('secp256k1GetProof' in event.data)
         {
             /* a proof is a attestation from the vault to another vault-using sign that this is indeed a pubex|pub from a particular origin */
             
             // purpose, derive
             // sign with webseed + 'vault' + m/0/0/0
             var callback = event.data.callback;
             var from = apphdkey[event.data.secp256k1GetProof.key.purpose].derive(
                  event.data.secp256k1GetProof.key.derive);
             var proofData = null; 
             if (event.data.secp256k1GetProof.proofType == 'pubex')
                proofData = from.publicExtendedKey;
             else if (event.data.secp256k1GetProof.proofType == 'pub')
                proofData = from.publicKey;
             
             var message = Buffer.from(JSON.stringify({ type: event.data.secp256k1GetProof.proofType, data: proofData, origin: apporigin }));
             var hash = crypto.createHash('sha256').update(message).digest();
             
             var seed2mnemonic = getWebseedMnemonic();
             
             var seed = bip39.mnemonicToSeed(seed2mnemonic, 'attest');
             var attestkey = hdkey.fromMasterSeed(seed).derive("m/0/0");
             
             var sig = secp256k1.sign(hash, attestkey.privateKey);            
             
             parent.postMessage({'callback' : callback, 'result' : { signature: sig.signature.toString('hex'), recovery: sig.recovery, message: message.toString('hex') }}, event.origin);
         }
         else if ('secp256k1VerifyProof' in event.data)
         {
             var callback = event.data.callback;   
             
             var message = Buffer.from(event.data.secp256k1VerifyProof.message, 'hex');
             var hash = crypto.createHash('sha256').update(message).digest();

             var signature = Buffer.from(event.data.secp256k1VerifyProof.signature, 'hex');
             var recovery = event.data.secp256k1VerifyProof.recovery;
             
             var senderPubKey = secp256k1.recover(hash, signature, recovery);

             var seed2mnemonic = getWebseedMnemonic();
             var seed = bip39.mnemonicToSeed(seed2mnemonic, 'attest');
             var attestkey = hdkey.fromMasterSeed(seed).derive("m/0/0");
             parent.postMessage({'callback' : callback, 'result' : senderPubKey.compare(attestkey.publicKey) == 0}, event.origin);
         }
     }
     
}

if (parent)
{
    console.log("Vault listening..");
    
    // setting up so we can receive messages to the secure vault
    window.addEventListener('message', handleSecureVaultMessage);
    
    parent.postMessage({'ready' : true}, '*');
}


// @source: https://github.com/zipperglobal/vault
