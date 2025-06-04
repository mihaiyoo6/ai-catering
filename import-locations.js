const fs = require("fs").promises;
const path = require("path");
const Redis = require("ioredis");
// Load environment variables from .env file
require("dotenv").config();

// --- Configuration ---
const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6379");
const GEOSPATIAL_KEY = process.env.GEOSPATIAL_KEY || "all_locations";
const LOCATIONS_FILE = path.join(
  __dirname,
  process.env.LOCATIONS_FILE || "location-db.json"
);

// --- Create a Redis client instance ---
const redis = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
});

redis.on("connect", () => {
  console.log("Connected to Redis server!");
});

redis.on("error", (err) => {
  console.error("Redis connection error:", err);
  process.exit(1); // Exit if Redis connection fails
});

/**
 * Sanitizes location data to ensure it's valid for Redis geospatial commands
 * @param {Array} locations - Array of location objects from JSON
 * @returns {Array} - Array of sanitized location objects
 */
function sanitizeLocationData(locations) {
  return locations.map((location) => {
    // Create a new object with the same properties
    const sanitized = { ...location };

    // Clean up longitude and latitude values
    if (typeof sanitized.longitude === "string") {
      if (sanitized.longitude.match(/^-?\d+(\.\d+)?$/)) {
        sanitized.longitude = parseFloat(sanitized.longitude);
      } else {
        // Try to find longitude in other fields if it got misplaced
        if (
          typeof sanitized.latitude === "string" &&
          sanitized.latitude.match(/^-?\d+(\.\d+)?$/)
        ) {
          // Perhaps latitude and longitude values are swapped
          sanitized.longitude = parseFloat(sanitized.latitude);
        } else {
          sanitized.longitude = null;
        }
      }
    }

    if (typeof sanitized.latitude === "string") {
      if (sanitized.latitude.match(/^-?\d+(\.\d+)?$/)) {
        sanitized.latitude = parseFloat(sanitized.latitude);
      } else {
        sanitized.latitude = null;
      }
    }

    // Handle the case where values might be in postal_code
    if (
      (sanitized.longitude === null || isNaN(sanitized.longitude)) &&
      typeof sanitized.postal_code === "string" &&
      sanitized.postal_code.match(/^-?\d+(\.\d+)?$/)
    ) {
      sanitized.longitude = parseFloat(sanitized.postal_code);
    }

    // Clean up restaurant name
    if (typeof sanitized.restaurant_name === "string") {
      sanitized.restaurant_name = sanitized.restaurant_name
        .replace(/"/g, "")
        .trim();
    }

    return sanitized;
  });
}
/**
 * Import locations from a JSON file into Redis geospatial index
 * @param {string} redisKey - The Redis key to store locations
 * @param {string} filePath - Path to the JSON file containing locations
 * @returns {Promise<number>} - Total number of locations added
 */
async function importLocationsToRedis(redisKey, filePath) {
  try {
    console.log(`Reading locations from ${filePath}...`);
    const fileData = await fs.readFile(filePath, "utf8");
    // Remove any potential comments from the JSON file
    const jsonData = fileData.replace(/\/\/.*$/gm, "");
    const locations = JSON.parse(jsonData);

    if (!Array.isArray(locations)) {
      throw new Error("Location data must be an array");
    }

    // Repair and sanitize location data before processing
    const repairedLocations = repairLocationData(locations);
    const sanitizedLocations = sanitizeLocationData(repairedLocations);

    console.log(`Found ${locations.length} raw entries in the file`);
    console.log(`After repair: ${repairedLocations.length} valid locations`);
    console.log(
      `After sanitization: ${sanitizedLocations.length} locations ready for import`
    );

    // Clear existing data for the key
    console.log(`Clearing existing data for key "${redisKey}"`);
    await redis.del(redisKey);

    // Process locations in batches to avoid sending too large commands
    const BATCH_SIZE = 100;
    let totalAdded = 0;

    for (let i = 0; i < sanitizedLocations.length; i += BATCH_SIZE) {
      const batch = sanitizedLocations.slice(i, i + BATCH_SIZE);
      const args = [];

      // Build args array for GEOADD command
      // [key, lon1, lat1, name1, lon2, lat2, name2, ...]
      for (const location of batch) {
        // Skip incomplete records or ones with invalid coordinates
        const longitude =
          typeof location.longitude === "string"
            ? parseFloat(location.longitude)
            : location.longitude;
        const latitude =
          typeof location.latitude === "string"
            ? parseFloat(location.latitude)
            : location.latitude;

        // Create a location name from available fields
        let locationName = location.restaurant_name?.trim() || "";

        // If restaurant_name is empty, use address and city
        if (!locationName && location.address) {
          locationName = location.address.replace(/"/g, "").trim();
          if (
            location.city &&
            typeof location.city === "string" &&
            !location.city.includes('"')
          ) {
            locationName += `, ${location.city.trim()}`;
          }
        }

        // Final validation
        if (
          !longitude ||
          !latitude ||
          isNaN(longitude) ||
          isNaN(latitude) ||
          typeof longitude !== "number" ||
          typeof latitude !== "number"
        ) {
          console.warn(
            `Skipping invalid location: ${JSON.stringify(location)}`
          );
          continue;
        }

        // Generate a unique ID for this location
        const locationId = `loc:${totalAdded + args.length / 3 + 1}`;

        // Store all location fields in a Redis hash
        const hashKey = `${redisKey}:${locationId}`;
        const locationData = {};

        // Add all original fields to the hash
        Object.entries(location).forEach(([key, value]) => {
          if (value !== null && value !== undefined && value !== "") {
            locationData[key] =
              typeof value === "object" ? JSON.stringify(value) : String(value);
          }
        });

        // Add the processed fields
        locationData.id = locationId;
        locationData.display_name = locationName || "Unknown";

        // Store the hash in Redis
        await redis.hmset(hashKey, locationData);

        // Add to args for GEOADD command (use ID as the member name)
        args.push(longitude, latitude, locationId);
      }

      if (args.length > 0) {
        try {
          // Execute GEOADD command with the current batch
          // Make sure we have complete sets of longitude, latitude, name
          if (args.length % 3 === 0) {
            const added = await redis.geoadd(redisKey, ...args);
            totalAdded += added;
            console.log(`Batch processed: ${added} locations added`);
          } else {
            console.error(
              `Invalid batch: args length (${args.length}) is not a multiple of 3`
            );
            console.log("First few args:", args.slice(0, 9));
          }
        } catch (err) {
          console.error(`Error adding batch: ${err.message}`);
          // Log the problematic values for debugging
          for (let i = 0; i < args.length; i += 3) {
            if (i + 2 < args.length) {
              console.error(
                `Problem entry: lon=${args[i]}, lat=${args[i + 1]}, name=${
                  args[i + 2]
                }`
              );
            }
          }
        }
      }
    }

    console.log(`Import completed. Total locations added: ${totalAdded}`);
    return totalAdded;
  } catch (error) {
    console.error("Error importing locations:", error);
    throw error;
  }
}

/**
 * Find and repair incomplete location entries in the data
 * This function attempts to merge standalone coordinate entries with their corresponding locations
 * @param {Array} locations - Array of location objects
 * @returns {Array} - Cleaned array of location objects
 */
function repairLocationData(locations) {
  const validLocations = [];
  let pendingLongitude = null;
  let pendingLatitude = null;
  let currentLocation = null;

  for (let i = 0; i < locations.length; i++) {
    const location = locations[i];

    // Check if this is a standalone coordinate entry (contains only longitude)
    if (location.longitude && Object.keys(location).length === 1) {
      pendingLongitude = location.longitude;
      continue;
    }

    // Check if this entry only has latitude
    if (location.latitude && Object.keys(location).length === 1) {
      pendingLatitude = location.latitude;
      continue;
    }

    // If we have a normal looking location
    if (location.restaurant_name || location.address) {
      // If we have pending coordinates, try to apply them
      if (pendingLongitude && !location.longitude) {
        location.longitude = pendingLongitude;
        pendingLongitude = null;
      }

      if (pendingLatitude && !location.latitude) {
        location.latitude = pendingLatitude;
        pendingLatitude = null;
      }

      validLocations.push(location);
      currentLocation = location;
    }
    // If it's neither a full location nor a coordinate, but we have a current location,
    // it might be additional data for the current location
    else if (currentLocation) {
      // Check if it has coordinates we need
      if (location.longitude && !currentLocation.longitude) {
        currentLocation.longitude = location.longitude;
      }
      if (location.latitude && !currentLocation.latitude) {
        currentLocation.latitude = location.latitude;
      }
    }
  }

  return validLocations;
}

/**
 * Find nearby locations within a given radius
 * @param {string} redisKey - The Redis key with geospatial data
 * @param {number} longitude - Search center longitude
 * @param {number} latitude - Search center latitude
 * @param {number} radius - Search radius in km
 * @param {number} limit - Maximum number of results
 * @returns {Promise<Array>} - Array of locations with full details
 */
async function findNearbyLocations(
  redisKey,
  longitude,
  latitude,
  radius = 40075, // Default to Earth's circumference in km
  limit = 5
) {
  try {
    // Find locations within radius using GEOSEARCH
    const results = await redis.geosearch(
      redisKey,
      "FROMLONLAT",
      longitude,
      latitude,
      "BYRADIUS",
      radius,
      "km",
      "WITHDIST",
      "COUNT",
      limit,
      "ASC"
    );

    // If no results found
    if (!results || results.length === 0) {
      return [];
    }

    // Get full details for each location
    const locations = [];
    for (const [locationId, distance] of results) {
      const locationData = await redis.hgetall(`${redisKey}:${locationId}`);
      if (locationData) {
        // Add the calculated distance to the location data
        locationData.distance_km = parseFloat(distance).toFixed(2);
        locations.push(locationData);
      }
    }

    return locations;
  } catch (error) {
    console.error(`Error finding nearby locations:`, error);
    return [];
  }
}

async function main() {
  try {
    await importLocationsToRedis(GEOSPATIAL_KEY, LOCATIONS_FILE);

    // Optional: Verify some of the imported data
    console.log("\n--- Verifying imported data ---");
    const count = await redis.zcard(GEOSPATIAL_KEY);
    console.log(`Total members in ${GEOSPATIAL_KEY}: ${count}`);

    // Get a random sample of locations
    const sampleMembers = await redis.zrange(GEOSPATIAL_KEY, 0, 4);
    console.log("Sample of imported location IDs:", sampleMembers);

    // Fetch full details of one sample location
    if (sampleMembers.length > 0) {
      const sampleLocationData = await redis.hgetall(
        `${GEOSPATIAL_KEY}:${sampleMembers[0]}`
      );
      console.log("\nSample location full details:");
      console.log(sampleLocationData);

      // Try to find nearby locations to this sample
      if (sampleLocationData.longitude && sampleLocationData.latitude) {
        console.log("\n--- Finding nearby locations ---", sampleLocationData);
        const longitude = parseFloat(sampleLocationData.longitude);
        const latitude = parseFloat(sampleLocationData.latitude);

        console.log(
          `Searching for 5 closest locations to: ${latitude}, ${longitude}`
        );
        const nearbyLocations = await findNearbyLocations(
          GEOSPATIAL_KEY,
          longitude,
          latitude
        );

        console.log(`Found ${nearbyLocations.length} nearby locations:`);
        nearbyLocations.forEach((location) => {
          console.log(
            `- ${location.display_name || location.restaurant_name} (${
              location.distance_km
            } km)`
          );
        });
      }
    }
  } catch (error) {
    console.error("An error occurred:", error);
  } finally {
    // Close the Redis connection
    await redis.quit();
    console.log("\nDisconnected from Redis server.");
  }
}

// Run the import process
main();
