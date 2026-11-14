// Uses bcryptjs if it is installed, otherwise bcrypt
let bcrypt;
try {
  bcrypt = require('bcryptjs');
} catch (e) {
  bcrypt = require('bcrypt');
}
module.exports = bcrypt;
