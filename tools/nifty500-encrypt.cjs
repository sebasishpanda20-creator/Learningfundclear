// Only encrypted snapshots are committed; the private key exists in Sites secrets.
const fs=require('fs'),c=require('crypto');
const [input,output]=process.argv.slice(2);const raw=fs.readFileSync(input);const data=JSON.parse(raw);
if(data.version!==1||!['delayed','eod'].includes(data.mode)||data.rows.length!==data.total)throw Error('Invalid snapshot');
const key=c.randomBytes(32),iv=c.randomBytes(12),cipher=c.createCipheriv('aes-256-gcm',key,iv);
const encrypted=Buffer.concat([cipher.update(require('zlib').gzipSync(raw)),cipher.final(),cipher.getAuthTag()]);
const wrapped=c.publicEncrypt({key:fs.readFileSync('market-data/feed-public-key.pem'),oaepHash:'sha256',padding:c.constants.RSA_PKCS1_OAEP_PADDING},key);
fs.writeFileSync(output,JSON.stringify({version:1,key:wrapped.toString('base64'),iv:iv.toString('base64'),data:encrypted.toString('base64')}));
