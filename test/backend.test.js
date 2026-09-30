const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { createServer } = require('../server');

test('API stores linked appointments and stakeholders in SQLite', async t => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'careflow-'));
	const databaseFile = path.join(directory, 'careflow.db');
	const seedFile = path.join(directory, 'seed-data.json');
	fs.writeFileSync(seedFile, JSON.stringify({ stakeholders: [], appointments: [] }));
	const server = createServer({ databaseFile, seedFile });
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	t.after(async () => {
		await new Promise(resolve => server.close(resolve));
		fs.rmSync(directory, { recursive: true, force: true });
	});
	const baseUrl = `http://127.0.0.1:${server.address().port}`;

	const providerResponse = await fetch(`${baseUrl}/api/stakeholders`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ name: 'Dr. Test Provider', role: 'provider', specialty: 'Family medicine' })
	});
	assert.equal(providerResponse.status, 201);
	const provider = await providerResponse.json();

	const patientResponse = await fetch(`${baseUrl}/api/stakeholders`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ name: 'Sam Lee', role: 'patient' })
	});
	assert.equal(patientResponse.status, 201);
	const patient = await patientResponse.json();

	const createdResponse = await fetch(`${baseUrl}/api/appointments`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ date: '2026-09-30', time: '13:15', patientId: patient.id, providerId: provider.id, type: 'Consultation', duration: 30 })
	});
	assert.equal(createdResponse.status, 201);
	const created = await createdResponse.json();
	assert.equal(created.patientName, 'Sam Lee');
	assert.equal(created.patientId, patient.id);
	assert.equal(created.providerName, 'Dr. Test Provider');

	const listResponse = await fetch(`${baseUrl}/api/appointments?date=2026-09-30`);
	assert.equal(listResponse.status, 200);
	assert.deepEqual((await listResponse.json()).map(item => item.id), [created.id]);
	const patientListResponse = await fetch(`${baseUrl}/api/stakeholders?role=patient`);
	assert.deepEqual((await patientListResponse.json()).map(item => item.id), [patient.id]);
	const storedDatabase = new DatabaseSync(databaseFile);
	assert.equal(storedDatabase.prepare('SELECT COUNT(*) AS count FROM appointments').get().count, 1);
	assert.equal(storedDatabase.prepare('SELECT COUNT(*) AS count FROM stakeholders').get().count, 2);
	storedDatabase.close();

	const invalidResponse = await fetch(`${baseUrl}/api/appointments`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ date: '2026-02-31', time: '99:00', patientName: '', type: '', duration: 30 })
	});
	assert.equal(invalidResponse.status, 400);
});
