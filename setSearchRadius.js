// setSearchRadius.js – run with `node setSearchRadius.js`
// This script sets the system setting `bus_stop_search_radius_km` to 5 (km).
// It uses the existing Sequelize models configuration.

const path = require('path');
const models = require(path.join(__dirname, 'models'));

(async () => {
  try {
    const { SystemSetting } = models;
    await SystemSetting.upsert({ key: 'bus_stop_search_radius_km', value: '5' });
    console.log('bus_stop_search_radius_km set to 5 km');
    process.exit(0);
  } catch (err) {
    console.error('Error updating setting:', err);
    process.exit(1);
  }
})();
