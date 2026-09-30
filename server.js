const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createDatabase } = require('./database');

function sendJson(response, statusCode, body) {
	response.writeHead(statusCode, {
		'Content-Type': 'application/json; charset=utf-8',
		'Cache-Control': 'no-store',
		'X-Content-Type-Options': 'nosniff'
	});
	response.end(JSON.stringify(body));
}

function isValidDate(value) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function readBody(request) {
	return new Promise((resolve, reject) => {
		let body = '';
		request.on('data', chunk => {
			body += chunk;
			if (body.length > 16_384) {
				reject(Object.assign(new Error('Request body is too large.'), { statusCode: 413 }));
				request.destroy();
			}
		});
		request.on('end', () => {
			try {
				resolve(JSON.parse(body || '{}'));
			} catch {
				reject(Object.assign(new Error('Request body must be valid JSON.'), { statusCode: 400 }));
			}
		});
		request.on('error', reject);
	});
}

function createServer(options = {}) {
	const database = createDatabase(options.databaseFile, options.seedFile);
	const server = http.createServer(async (request, response) => {
		const url = new URL(request.url, 'http://localhost');
		try {
			if (request.method === 'GET' && url.pathname === '/') {
				response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
				response.end(fs.readFileSync(path.join(__dirname, 'index.html')));
				return;
			}

			if (request.method === 'GET' && url.pathname === '/api/health') {
				sendJson(response, 200, { status: 'ok' });
				return;
			}

			if (url.pathname === '/api/appointments' && request.method === 'GET') {
				const date = url.searchParams.get('date');
				const month = url.searchParams.get('month');
				if (date && !isValidDate(date)) {
					sendJson(response, 400, { error: 'Date must use YYYY-MM-DD format.' });
					return;
				}
				if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
					sendJson(response, 400, { error: 'Month must use YYYY-MM format.' });
					return;
				}
				sendJson(response, 200, database.listAppointments(date, month));
				return;
			}

			if (url.pathname === '/api/stakeholders' && request.method === 'GET') {
				const role = url.searchParams.get('role');
				if (role && !['patient', 'provider', 'staff'].includes(role)) {
					sendJson(response, 400, { error: 'Role must be patient, provider, or staff.' });
					return;
				}
				sendJson(response, 200, database.listStakeholders(role));
				return;
			}

			if (url.pathname === '/api/stakeholders' && request.method === 'POST') {
				const body = await readBody(request);
				const person = {
					name: typeof body.name === 'string' ? body.name.trim() : '',
					role: body.role,
					specialty: typeof body.specialty === 'string' ? body.specialty.trim() : '',
					email: typeof body.email === 'string' ? body.email.trim() : '',
					phone: typeof body.phone === 'string' ? body.phone.trim() : ''
				};
				if (!person.name || person.name.length > 100 || !['patient', 'provider', 'staff'].includes(person.role) || person.specialty.length > 100 || person.email.length > 254 || person.phone.length > 40) {
					sendJson(response, 400, { error: 'Enter a name (up to 100 characters), valid role, and contact details within their length limits.' });
					return;
				}
				sendJson(response, 201, database.createStakeholder(person));
				return;
			}

			if (url.pathname === '/api/appointments' && request.method === 'POST') {
				const body = await readBody(request);
				const patientName = typeof body.patientName === 'string' ? body.patientName.trim() : '';
				const type = typeof body.type === 'string' ? body.type.trim() : '';
				const validDuration = [15, 30, 45, 60].includes(Number(body.duration));
				if ((!patientName && !body.patientId) || patientName.length > 100 || !type || type.length > 100 || !isValidDate(body.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.time || '') || !validDuration) {
					sendJson(response, 400, { error: 'Enter a patient name or ID, appointment type, valid date and time, and duration of 15, 30, 45, or 60 minutes.' });
					return;
				}
				const appointment = database.createAppointment({ ...body, patientName, type });
				sendJson(response, 201, appointment);
				return;
			}

			sendJson(response, 404, { error: 'Not found.' });
		} catch (error) {
			if (!response.headersSent) sendJson(response, error.statusCode || 500, { error: error.statusCode ? error.message : 'Internal server error.' });
		}
	});
	server.on('close', () => database.close());
	return server;
}

if (require.main === module) {
	const port = Number(process.env.PORT) || 3000;
	createServer().listen(port, () => console.log(`Careflow demo server running at http://localhost:${port}`));
}

module.exports = { createServer };
