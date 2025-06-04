# AI Catering Location Service

A tool for importing, managing, and searching restaurant and catering locations using Redis geospatial features.

## Project Overview

This project provides tools to:

1. Convert CSV files to JSON format
2. Import location data into Redis with geospatial indexing
3. Search for nearby locations based on coordinates

## Prerequisites

- Node.js (v12 or higher)
- Redis server running locally or remotely
- Basic understanding of geospatial data concepts

## Installation

1. Clone this repository or download the source files
2. Install dependencies:

```bash
npm install
```

## Configuration

This project uses environment variables for configuration. Copy the `.env.example` file to a new file named `.env` and adjust the values as needed:

```bash
# Copy example environment file
cp .env.example .env
```

You can configure the following variables in the `.env` file:

- `REDIS_HOST`: Redis server hostname (default: "localhost")
- `REDIS_PORT`: Redis server port (default: 6379)
- `REDIS_USERNAME`: Redis username for authentication (optional)
- `REDIS_PASSWORD`: Redis password for authentication (optional)
- `REDIS_USE_TLS`: Set to 'true' to enable secure TLS connection (default: false)
- `GEOSPATIAL_KEY`: The Redis key for geospatial index (default: "all_locations")
- `LOCATIONS_FILE`: Path to the JSON file containing location data (default: "location-db.json")

## Usage

### Converting CSV to JSON

If your location data is in CSV format, you can convert it to JSON using the `csv-json.js` script:

```bash
node csv-json.js location-db.csv location-db.json
```

Arguments:

- `location-db.csv`: Input CSV file path
- `location-db.json`: (Optional) Output JSON file path (defaults to input filename with .json extension)

### Importing Locations to Redis

Once you have your location data in JSON format, you can import it to Redis:

```bash
node import-locations.js
```

This script will:

1. Read from the configured JSON file
2. Clean and repair any problematic data entries
3. Import locations into Redis with geospatial indexing
4. Store complete location details as Redis hashes
5. Verify the import by displaying sample data

### Finding Nearby Locations

The `findNearbyLocations` function in `import-locations.js` can be used to search for locations near specific coordinates:

```javascript
const nearbyLocations = await findNearbyLocations(
  "all_locations", // Redis key
  longitude, // Center longitude
  latitude, // Center latitude
  radius, // Search radius in km (optional, defaults to Earth's circumference)
  limit // Maximum results (optional, defaults to 5)
);
```

## Data Format

The expected JSON data format is an array of location objects, each containing:

- `restaurant_name`: Name of the establishment
- `longitude`: Geographical longitude (numeric)
- `latitude`: Geographical latitude (numeric)
- Additional fields (optional): address, city, postal_code, etc.

Example:

```json
[
  {
    "restaurant_name": "Pizza Palace",
    "longitude": -73.9857,
    "latitude": 40.7484,
    "address": "123 Main St",
    "city": "New York"
  }
]
```

## Troubleshooting

- **Redis Connection Issues**: Ensure Redis is running and accessible. Check the host/port settings.
- **Import Errors**: Check your JSON data format. The script logs skipped entries with invalid coordinates.
- **Data Quality**: Use the repair and sanitize functions to handle problematic data.
