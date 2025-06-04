const fs = require("fs").promises; // Use fs.promises for async/await

/**
 * Converts a CSV string into a JSON string (array of objects).
 * Assumes the first line of the CSV is the header row.
 *
 * @param {string} csv - The CSV data as a string.
 * @returns {string} The JSON representation of the CSV data, pretty-printed.
 */
function csvToJson(csv) {
  const lines = csv.split("\n");
  const result = [];
  // Split headers by comma, and trim any leading/trailing whitespace
  const headers = lines[0]
    .split(",")
    .map((header) => header.trim().replace(/\s+/g, "_").toLowerCase());

  for (let i = 1; i < lines.length; i++) {
    const obj = {};
    // Handle quoted fields properly
    let currentline = [];
    const rowText = lines[i];

    // Skip empty lines that might result from extra newlines at the end of the file
    if (!rowText.trim()) {
      continue;
    }

    // More robust CSV parsing to handle quoted fields with commas
    let inQuotes = false;
    let currentField = "";

    for (let k = 0; k < rowText.length; k++) {
      const char = rowText[k];

      if (char === '"' && (k === 0 || rowText[k - 1] !== "\\")) {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        // End of field, add to the line
        currentline.push(currentField);
        currentField = "";
      } else {
        currentField += char;
      }
    }

    // Add the last field
    currentline.push(currentField);

    // Process each field
    for (let j = 0; j < headers.length; j++) {
      const header = headers[j];
      // Get the value, trim it, and handle cases where a value might be missing for a header
      const rawValue = j < currentline.length ? currentline[j] : null;
      const value =
        rawValue !== null ? rawValue.trim().replace(/^"|"$/g, "") : "";

      // Handle empty values specifically
      if (value === "") {
        obj[header] = null; // Set empty fields to null instead of empty string
      }
      // Attempt to convert to number if it looks like one and is not empty
      else if (!isNaN(value) && value !== "") {
        obj[header] = Number(value);
      } else {
        obj[header] = value;
      }
    }
    result.push(obj);
  }
  // Convert the array of objects to a pretty-printed JSON string
  return JSON.stringify(result, null, 2);
}

/**
 * Reads a CSV file, converts its content to JSON, and saves it to a new JSON file.
 *
 * @param {string} inputCsvFilePath - The path to the input CSV file.
 * @param {string} outputJsonFilePath - The path where the output JSON file will be saved.
 */
async function convertCsvFileToJson(inputCsvFilePath, outputJsonFilePath) {
  try {
    // Read the CSV file content
    const csvData = await fs.readFile(inputCsvFilePath, "utf8");
    console.log(`Successfully read CSV file: ${inputCsvFilePath}`);

    // Convert the CSV data to JSON
    const jsonData = csvToJson(csvData);

    // Write the JSON data to the output file
    await fs.writeFile(outputJsonFilePath, jsonData, "utf8");
    console.log(
      `Successfully converted CSV to JSON and saved to: ${outputJsonFilePath}`
    );
  } catch (err) {
    // Log any errors that occur during file reading or writing
    console.error(`Error processing file ${inputCsvFilePath}:`, err);
  }
}

// --- Command Line Usage ---
// To run this script from the command line:
// 1. Save the code as a .js file (e.g., `converter.js`).
// 2. Create a `data.csv` file in the same directory with some CSV content, e.g.:
//    name,age,city
//    Alice,30,New York
//    Bob,24,London
//    Charlie,35,Paris
// 3. Run from your terminal, passing the input CSV file path as an argument:
//    `node converter.js data.csv`
//    You can also specify an output file:
//    `node converter.js data.csv my_output.json`

// Get command line arguments. process.argv[0] is 'node', process.argv[1] is the script path.
const args = process.argv.slice(2); // Get arguments starting from the third element

if (args.length === 0) {
  console.error(
    "Usage: node converter.js <input_csv_file_path> [output_json_file_path]"
  );
  process.exit(1); // Exit with an error code
}

const inputCsv = args[0];
// If a second argument is provided, use it as the output JSON file path.
// Otherwise, default to 'output.json' in the same directory as the input CSV.
const outputJson =
  args[1] ||
  `${inputCsv.substring(0, inputCsv.lastIndexOf(".")) || inputCsv}.json`;

// Call the function to perform the conversion
convertCsvFileToJson(inputCsv, outputJson);
