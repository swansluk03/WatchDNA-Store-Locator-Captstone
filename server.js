const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();

app.get('/mapbox-tileset', async (req, res) => {
  try {
    const tilesetId = 'hjagdeep.cmgiy3sld25iq1omnu66a4ego-2jrng'; //this needs to be public? i think?

    const response = await axios.get(`https://api.mapbox.com/v4/${tilesetId}.json`, {
      params: {
        access_token: process.env.MAPBOX_SECRET
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error('Mapbox Tileset API error:', error.response?.data || error.message);
    res.status(500).send('Error fetching tileset metadata');
  }
});

app.listen(3000, () => console.log('Server running on port 3000'));