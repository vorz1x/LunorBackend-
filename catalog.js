const fs = require('fs');
const config = require('../config');
let catalog = require(config.catalogFile);

function reloadCatalog() {
  catalog = JSON.parse(fs.readFileSync(config.catalogFile));
}

function getCatalog() {
  return catalog;
}

function buy(user, itemId) {
  for (const section in catalog) {
    const item = catalog[section].items.find(i => i.id === itemId);
    if (item && user.vbucks >= item.price) {
      user.vbucks -= item.price;
      user.ownedItems.push(itemId);
      user.save();
      return true;
    }
  }
  return false;
}

// gift(), refund(), etc...

module.exports = { reloadCatalog, getCatalog, buy };