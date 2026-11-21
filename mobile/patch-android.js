/* Android : « Ouvrir avec Plume » pour les documents + accès au stockage */
'use strict';
const fs = require('fs'), path = require('path');
const mf = path.join(__dirname, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
let x = fs.readFileSync(mf, 'utf8');
const mimes = ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword', 'application/vnd.oasis.opendocument.text',
  'application/rtf', 'text/rtf', 'application/pdf', 'text/plain', 'text/markdown', 'text/html'];
const filter = `
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
${mimes.map(m => `                <data android:mimeType="${m}" />`).join('\n')}
            </intent-filter>`;
if (!x.includes('android.intent.action.VIEW')) x = x.replace(/(<activity[\s\S]*?<\/intent-filter>)/, `$1${filter}`);
if (!x.includes('READ_EXTERNAL_STORAGE')) x = x.replace('<uses-permission android:name="android.permission.INTERNET" />', '<uses-permission android:name="android.permission.INTERNET" />\n    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />\n    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />');
fs.writeFileSync(mf, x);
console.log('AndroidManifest : associations de documents ajoutées');
