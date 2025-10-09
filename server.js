const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();

app.get('/mapbox-data', async (req, res) => {
  try {
    const response = await axios.get('https://api.mapbox.com/datasets/v1/YOUR_USERNAME/YOUR_DATASET_ID/features', {
      headers: {
        Authorization: `Bearer ${process.env.MAPBOX_SECRET}`
      }
    });
    res.json(response.data);
  } catch (error) {
    res.status(500).send('Error fetching Mapbox data');
  }
});

app.listen(3000, () => console.log('Server running on port 3000'));
