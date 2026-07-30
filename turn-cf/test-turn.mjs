import { chromium } from 'playwright';
import { createServer } from 'node:http';

const res = await fetch('https://speed.cloudflare.com/turn-creds', {
  headers: { Origin: 'https://speed.cloudflare.com' }
});
const { urls, username, credential } = await res.json();
console.log('TURN urls:', urls);
console.log('username:', username.slice(0, 15) + '...');

const html = `<!DOCTYPE html>
<html><body><script>
const config = ${JSON.stringify({ iceServers: [{ urls, username, credential }] })};

window.data = { candidates: [], errors: [] };
const pc = new RTCPeerConnection(config);

pc.onicecandidate = (e) => {
  if (e.candidate) {
    window.data.candidates.push({ type: e.candidate.type, address: e.candidate.address, port: e.candidate.port, protocol: e.candidate.protocol, tcpType: e.candidate.tcpType, relayProtocol: e.candidate.relayProtocol });
  }
};

pc.onicegatheringstatechange = () => {
  window.data.state = pc.iceGatheringState;
  if (pc.iceGatheringState === 'complete') window.done = true;
};

pc.oniceconnectionstatechange = () => { window.data.iceState = pc.iceConnectionState; };
try {
  pc.createDataChannel('test');
  pc.createOffer().then(o => pc.setLocalDescription(o)).catch(e => { window.data.errors.push('sdp:'+e.message); });
} catch(e) { window.data.errors.push(e.message); }

setTimeout(() => { window.done = true; }, 25000);
</script></body></html>`;

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
});

await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
console.log(`Server on port ${port}`);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${port}`);

await page.waitForFunction(() => window.done, { timeout: 30000 });

const data = await page.evaluate(() => window.data);

console.log(`\nGathering state: ${data.state}`);
console.log(`ICE state: ${data.iceState}`);
console.log(`Errors: ${data.errors.length > 0 ? data.errors.join(', ') : 'none'}`);
console.log(`Candidates: ${data.candidates.length}`);
data.candidates.forEach((c, i) => console.log(`  [${i}] ${c.type} ${c.address || '-'}:${c.port || '-'} proto=${c.protocol || '-'} relayProto=${c.relayProtocol || '-'}`));

if (data.candidates.some(c => c.type === 'relay')) {
  console.log('\n✓ TURN works');
} else {
  console.log('\n✗ No relay candidates');
}

server.close();
await browser.close();
