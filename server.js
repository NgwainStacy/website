const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const dataFile = path.join(__dirname, 'appointments.json');

function readAppointments() {
	return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
}

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
	const appointmentsFile = options.dataFile || dataFile;
	return http.createServer(async (request, response) => {
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
				const appointments = JSON.parse(fs.readFileSync(appointmentsFile, 'utf8'));
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
				const filtered = appointments.filter(item => (!date || item.date === date) && (!month || item.date.startsWith(month)));
				sendJson(response, 200, filtered);
				return;
			}

			if (url.pathname === '/api/appointments' && request.method === 'POST') {
				const body = await readBody(request);
				const patientName = typeof body.patientName === 'string' ? body.patientName.trim() : '';
				const type = typeof body.type === 'string' ? body.type.trim() : '';
				const validDuration = [15, 30, 45, 60].includes(Number(body.duration));
				if (!patientName || patientName.length > 100 || !type || type.length > 100 || !isValidDate(body.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.time || '') || !validDuration) {
					sendJson(response, 400, { error: 'Enter a patient name, appointment type, valid date and time, and duration of 15, 30, 45, or 60 minutes.' });
					return;
				}

				const appointments = JSON.parse(fs.readFileSync(appointmentsFile, 'utf8'));
				const appointment = {
					id: randomUUID(),
					date: body.date,
					time: body.time,
					patientName,
					type,
					duration: Number(body.duration),
					status: 'Confirmed'
				};
				appointments.push(appointment);
				appointments.sort((first, second) => `${first.date}T${first.time}`.localeCompare(`${second.date}T${second.time}`));
				fs.writeFileSync(appointmentsFile, `${JSON.stringify(appointments, null, 2)}\n`);
				sendJson(response, 201, appointment);
				return;
			}

			sendJson(response, 404, { error: 'Not found.' });
		} catch (error) {
			if (!response.headersSent) sendJson(response, error.statusCode || 500, { error: error.statusCode ? error.message : 'Internal server error.' });
		}
	});
}

if (require.main === module) {
	const port = Number(process.env.PORT) || 3000;
	createServer().listen(port, () => console.log(`Careflow demo server running at http://localhost:${port}`));
}

module.exports = { createServer };
