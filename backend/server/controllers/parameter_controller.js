const database = require('../db');

function list(request, response) {
  response.json(database.listParameters());
}

function save(request, response, next) {
  try {
    if (!Array.isArray(request.body.parameters)) {
      return response.status(400).json({ error: 'Field parameters harus berupa array.' });
    }
    response.json(database.saveParameters(request.body.parameters));
  } catch (error) {
    next(error);
  }
}

module.exports = { list, save };
