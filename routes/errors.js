// routes/errors.js
// Turns database errors into clear JSON answers, so a broken constraint shows
// up in the demo as a readable message instead of a crash.

const {
  UniqueConstraintError,
  ForeignKeyConstraintError,
  ValidationError,
  DatabaseError,
} = require('sequelize');

// Express 4 does not catch errors thrown inside async handlers; this does.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function describe(err) {
  // UNIQUE constraint, e.g. a second character with the same name
  if (err instanceof UniqueConstraintError) {
    return {
      status: 409,
      body: {
        error: 'UNIQUE constraint violated',
        constraint: err.original && err.original.sqlMessage,
        fields: err.fields,
      },
    };
  }
  // FOREIGN KEY, e.g. species_id 99999 does not exist
  if (err instanceof ForeignKeyConstraintError) {
    return {
      status: 409,
      body: { error: 'FOREIGN KEY constraint violated', detail: err.original && err.original.sqlMessage },
    };
  }
  // NOT NULL (allowNull: false in the models), e.g. a character with no name
  if (err instanceof ValidationError) {
    return {
      status: 400,
      body: { error: 'Validation failed', detail: err.errors.map((e) => e.message) },
    };
  }
  // CHECK constraint (MySQL error 3819), e.g. power_level = 11
  if (err instanceof DatabaseError && err.original && err.original.errno === 3819) {
    return { status: 400, body: { error: 'CHECK constraint violated', detail: err.original.sqlMessage } };
  }
  if (err instanceof DatabaseError) {
    return { status: 400, body: { error: 'Database error', detail: err.original ? err.original.sqlMessage : err.message } };
  }
  if (err.type === 'entity.parse.failed') {
    return { status: 400, body: { error: 'Request body is not valid JSON' } };
  }
  return { status: err.status || 500, body: { error: err.message } };
}

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const { status, body } = describe(err);
  if (status >= 500) console.error(err);
  res.status(status).json(body);
}

module.exports = { wrap, errorHandler };
