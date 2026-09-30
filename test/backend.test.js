const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createServer } = require('../server');

test('API lists appointments and persists validated creations', async t => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'careflow-'));
	const dataFile = path.join(directory, 'appointments.json');
	fs.writeFileSync(dataFile, '[]');
	const server = createServer({ dataFile });
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	t.after(() => {
		server.close();
		fs.rmSync(directory, { recursive: true, force: true });
	});
	const baseUrl = `http://127.0.0.1:${server.address().port}`;

	const createdResponse = await fetch(`${baseUrl}/api/appointments`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ date: '2026-09-30', time: '13:15', patientName: 'Sam Lee', type: 'Consultation', duration: 30 })
	});
	assert.equal(createdResponse.status, 201);
	const created = await createdResponse.json();
	assert.equal(created.patientName, 'Sam Lee');

	const listResponse = await fetch(`${baseUrl}/api/appointments?date=2026-09-30`);
	assert.equal(listResponse.status, 200);
	assert.deepEqual((await listResponse.json()).map(item => item.id), [created.id]);
	assert.equal(JSON.parse(fs.readFileSync(dataFile, 'utf8')).length, 1);

	const invalidResponse = await fetch(`${baseUrl}/api/appointments`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ date: '2026-02-31', time: '99:00', patientName: '', type: '', duration: 30 })
	});
	assert.equal(invalidResponse.status, 400);
});
