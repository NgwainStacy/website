const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const defaultDatabaseFile = path.join(__dirname, 'careflow.db');
const defaultSeedFile = path.join(__dirname, 'seed-data.json');

function createDatabase(databaseFile = defaultDatabaseFile, seedFile = defaultSeedFile) {
	const database = new DatabaseSync(databaseFile);
	database.exec(`
		PRAGMA foreign_keys = ON;
		CREATE TABLE IF NOT EXISTS stakeholders (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			role TEXT NOT NULL CHECK (role IN ('patient', 'provider', 'staff')),
			specialty TEXT NOT NULL DEFAULT '',
			email TEXT NOT NULL DEFAULT '',
			phone TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS stakeholders_role_name ON stakeholders(role, name);
		CREATE TABLE IF NOT EXISTS appointments (
			id TEXT PRIMARY KEY,
			patient_id TEXT NOT NULL REFERENCES stakeholders(id) ON DELETE RESTRICT,
			provider_id TEXT REFERENCES stakeholders(id) ON DELETE RESTRICT,
			date TEXT NOT NULL,
			time TEXT NOT NULL,
			type TEXT NOT NULL,
			duration INTEGER NOT NULL CHECK (duration IN (15, 30, 45, 60)),
			status TEXT NOT NULL DEFAULT 'Confirmed',
			created_at TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS appointments_date_time ON appointments(date, time);
	`);

	const countStakeholders = database.prepare('SELECT COUNT(*) AS count FROM stakeholders').get().count;
	if (countStakeholders === 0 && fs.existsSync(seedFile)) {
		const seed = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
		const insertStakeholder = database.prepare(`
			INSERT OR IGNORE INTO stakeholders (id, name, role, specialty, email, phone, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`);
		const insertAppointment = database.prepare(`
			INSERT OR IGNORE INTO appointments (id, patient_id, provider_id, date, time, type, duration, status, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
		database.exec('BEGIN');
		try {
			const now = new Date().toISOString();
			for (const person of seed.stakeholders || []) {
				insertStakeholder.run(person.id || randomUUID(), person.name, person.role, person.specialty || '', person.email || '', person.phone || '', now);
			}
			const provider = database.prepare("SELECT id FROM stakeholders WHERE role = 'provider' ORDER BY name LIMIT 1").get();
			for (const appointment of seed.appointments || []) {
				let patient = database.prepare("SELECT id FROM stakeholders WHERE role = 'patient' AND name = ? COLLATE NOCASE").get(appointment.patientName);
				if (!patient) {
					const patientId = randomUUID();
					insertStakeholder.run(patientId, appointment.patientName, 'patient', '', '', '', now);
					patient = { id: patientId };
				}
				insertAppointment.run(appointment.id || randomUUID(), patient.id, provider?.id || null, appointment.date, appointment.time, appointment.type, appointment.duration, appointment.status || 'Confirmed', now);
			}
			database.exec('COMMIT');
		} catch (error) {
			database.exec('ROLLBACK');
			throw error;
		}
	}

	const listAppointmentsStatement = database.prepare(`
		SELECT appointments.id, appointments.patient_id AS patientId, stakeholders.name AS patientName,
			appointments.provider_id AS providerId, providers.name AS providerName,
			appointments.date, appointments.time, appointments.type, appointments.duration, appointments.status
		FROM appointments
		JOIN stakeholders ON stakeholders.id = appointments.patient_id
		LEFT JOIN stakeholders AS providers ON providers.id = appointments.provider_id
		WHERE (? IS NULL OR appointments.date = ?)
			AND (? IS NULL OR substr(appointments.date, 1, 7) = ?)
		ORDER BY appointments.date, appointments.time
	`);
	const listStakeholdersStatement = database.prepare(`
		SELECT id, name, role, specialty, email, phone, created_at AS createdAt
		FROM stakeholders
		WHERE (? IS NULL OR role = ?)
		ORDER BY role, name
	`);

	return {
		listAppointments(date = null, month = null) {
			return listAppointmentsStatement.all(date, date, month, month);
		},
		listStakeholders(role = null) {
			return listStakeholdersStatement.all(role, role);
		},
		createStakeholder(person) {
			const stakeholder = {
				id: randomUUID(),
				name: person.name,
				role: person.role,
				specialty: person.specialty || '',
				email: person.email || '',
				phone: person.phone || '',
				createdAt: new Date().toISOString()
			};
			database.prepare(`
				INSERT INTO stakeholders (id, name, role, specialty, email, phone, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)
			`).run(stakeholder.id, stakeholder.name, stakeholder.role, stakeholder.specialty, stakeholder.email, stakeholder.phone, stakeholder.createdAt);
			return stakeholder;
		},
		createAppointment(appointment) {
			let patient;
			if (appointment.patientId) {
				patient = database.prepare("SELECT id, name FROM stakeholders WHERE id = ? AND role = 'patient'").get(appointment.patientId);
				if (!patient) throw Object.assign(new Error('Patient stakeholder was not found.'), { statusCode: 400 });
			} else {
				patient = database.prepare("SELECT id, name FROM stakeholders WHERE role = 'patient' AND name = ? COLLATE NOCASE").get(appointment.patientName);
				if (!patient) {
					const stakeholder = this.createStakeholder({ name: appointment.patientName, role: 'patient' });
					patient = { id: stakeholder.id, name: stakeholder.name };
				}
			}
			const providerId = appointment.providerId || database.prepare("SELECT id FROM stakeholders WHERE role = 'provider' ORDER BY name LIMIT 1").get()?.id || null;
			if (providerId && !database.prepare("SELECT id FROM stakeholders WHERE id = ? AND role = 'provider'").get(providerId)) {
				throw Object.assign(new Error('Provider stakeholder was not found.'), { statusCode: 400 });
			}
			const record = {
				id: randomUUID(),
				patientId: patient.id,
				patientName: patient.name,
				providerId,
				providerName: providerId ? database.prepare('SELECT name FROM stakeholders WHERE id = ?').get(providerId).name : null,
				date: appointment.date,
				time: appointment.time,
				type: appointment.type,
				duration: Number(appointment.duration),
				status: 'Confirmed'
			};
			database.prepare(`
				INSERT INTO appointments (id, patient_id, provider_id, date, time, type, duration, status, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			`).run(record.id, record.patientId, record.providerId, record.date, record.time, record.type, record.duration, record.status, new Date().toISOString());
			return record;
		},
		close() {
			database.close();
		}
	};
}

module.exports = { createDatabase };
