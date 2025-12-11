import { google } from 'googleapis';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Google Sheets configuration
const SPREADSHEET_ID = '15KSNdceVyEIv8O8F6Za93oi_SLtA-V2S83ARzAbFZQg';
const SHEET_NAME = 'Sheet1'; // Default sheet name
const HEADER_ROW = 1; // Header row number
const DATA_START_ROW = 2; // Data starts from row 2 (after headers)
const RANGE = 'A:I'; // Columns A to I (Session, Name, Phone, Interest, City, Education, Intake, Budget, Status)

/**
 * Initialize Google Sheets API client
 */
async function getSheetsClient() {
  try {
    let credentials = null;

    // OPTION 1: Try to get credentials from environment variable (for Render/production)
    // This is the RECOMMENDED way for deployment
    if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      try {
        credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
        console.log('✅ Using Google credentials from environment variable (GOOGLE_SERVICE_ACCOUNT_JSON)');
      } catch (e) {
        console.error('❌ Error parsing GOOGLE_SERVICE_ACCOUNT_JSON:', e.message);
      }
    }

    // OPTION 2: Try to read from file (for local development)
    if (!credentials) {
      const possiblePaths = [
        process.env.GOOGLE_SERVICE_ACCOUNT_PATH,
        '/Users/excollodev/Downloads/resolute-tracer-469504-r8-a1b7b9ac074a.json', // Absolute path
        join(__dirname, '../../Downloads/resolute-tracer-469504-r8-a1b7b9ac074a.json'),
        join(process.cwd(), 'resolute-tracer-469504-r8-a1b7b9ac074a.json'),
        join(process.cwd(), 'backend/resolute-tracer-469504-r8-a1b7b9ac074a.json'),
      ];

      // Try to find the credentials file
      for (const path of possiblePaths) {
        if (!path) continue;
        try {
          const fullPath = path.startsWith('/') ? path : join(process.cwd(), path);
          credentials = JSON.parse(readFileSync(fullPath, 'utf8'));
          console.log('✅ Found Google credentials at:', fullPath);
          break;
        } catch (e) {
          // File not found, try next path
          if (e.code !== 'ENOENT') {
            console.warn('⚠️ Error reading credentials file:', path, e.message);
          }
          continue;
        }
      }
    }

    if (!credentials) {
      throw new Error(
        'Google service account credentials not found. ' +
        'Please set GOOGLE_SERVICE_ACCOUNT_JSON environment variable (for Render) ' +
        'or GOOGLE_SERVICE_ACCOUNT_PATH to point to your JSON file (for local development).'
      );
    }

    // Create auth client
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    console.log('✅ Google Sheets client initialized successfully');
    return sheets;
  } catch (error) {
    console.error('❌ Error initializing Google Sheets client:', error);
    throw new Error(`Failed to initialize Google Sheets: ${error.message}`);
  }
}

/**
 * Find or create a row for the session in Google Sheets
 * @param {Object} conversationState - ConversationState instance
 * @returns {Promise<number>} Row number (1-indexed, including header)
 */
async function findOrCreateSessionRow(conversationState) {
  try {
    const sheets = await getSheetsClient();
    const sessionId = conversationState.sessionId;

    // If we already know the row number, return it
    if (conversationState.sheetRowNumber) {
      console.log(`📝 Reusing existing row ${conversationState.sheetRowNumber} for session ${sessionId}`);
      return conversationState.sheetRowNumber;
    }

    console.log(`🔍 Searching for session ${sessionId} in Google Sheets...`);

    // Read all data to find existing row with this session ID
    // We'll use column H (8th column) to store session ID temporarily, or search by name
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:Z`, // Read all columns
    });

    const rows = response.data.values || [];

    // Search for existing row by session ID (skip header row 1, start from row 2)
    // Session ID is in column A (index 0)
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      // Check if this row has the session ID in column A
      if (row && row[0] === sessionId) {
        const rowNumber = i + 1; // Convert 0-based index to 1-based row number
        conversationState.sheetRowNumber = rowNumber;
        console.log(`📝 Found existing row ${rowNumber} for session ${sessionId}`);
        return rowNumber;
      }
    }

    // Session not found - create NEW row at the end
    // Calculate next available row number (rows.length includes all rows including header)
    const newRowNumber = rows.length + 1;
    conversationState.sheetRowNumber = newRowNumber;

    console.log(`📝 Creating NEW row ${newRowNumber} for NEW session ${sessionId}`);
    console.log(`📝 Total existing rows: ${rows.length}, new row will be: ${newRowNumber}`);

    // Immediately set the session ID in column A of the new row
    try {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A${newRowNumber}`,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [[sessionId]],
        },
      });
      conversationState.sessionIdUpdated = true;
      console.log(`✅ Created row ${newRowNumber} and set Session ID: ${sessionId}`);
      return newRowNumber;
    } catch (error) {
      console.error('❌ Error setting session ID:', error);
      // Still return the row number even if session ID update failed
      return newRowNumber;
    }
  } catch (error) {
    console.error('❌ Error finding/creating session row:', error);
    throw error;
  }
}

/**
 * Update a specific field in Google Sheets for the session
 * @param {Object} conversationState - ConversationState instance
 * @param {string} fieldName - Field name (name, phoneNumber, programInterest, etc.)
 * @param {string} value - Value to update
 * @returns {Promise<void>}
 */
export async function updateFieldInGoogleSheets(conversationState, fieldName, value) {
  try {
    if (!conversationState) {
      throw new Error('ConversationState is required');
    }

    // Map field names to column letters
    // Column structure from user's sheet:
    // A=SessionId, B=Stu. Name, C=Phone Number, D=Course, E=City, F=Education, G=Intake Year, H=Budget, I=Status
    const fieldToColumn = {
      'sessionId': 'A',        // SessionId (Column A)
      'name': 'B',             // Stu. Name (Column B)
      'phoneNumber': 'C',      // Phone Number (Column C)
      'programInterest': 'D',  // Course (Column D)
      'city': 'E',             // City (Column E)
      'priorEducation': 'F',   // Education (Column F)
      'intakeYear': 'G',       // Intake Year (Column G)
      'budget': 'H',           // Budget (Column H)
      'status': 'I',           // Status (Column I) - Confirmed or Partial
    };

    const column = fieldToColumn[fieldName];
    if (!column) {
      console.warn(`⚠️ Unknown field: ${fieldName}`);
      return;
    }

    // Find or create row for this session
    const rowNumber = await findOrCreateSessionRow(conversationState);

    // Also update session ID in column A if this is the first field being updated
    if (!conversationState.sessionIdUpdated) {
      // Update session ID in column A
      const sessionCellRange = `${SHEET_NAME}!A${rowNumber}`;
      const sheets = await getSheetsClient();
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: sessionCellRange,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [[conversationState.sessionId]],
        },
      });
      conversationState.sessionIdUpdated = true;
      console.log(`📝 Updated Session ID in ${sessionCellRange}`);
    }



    const cellRange = `${SHEET_NAME}!${column}${rowNumber}`;

    console.log(`📝 Updating ${fieldName} = "${value}" in ${cellRange}`);

    // Get sheets client
    const sheets = await getSheetsClient();

    // Update the specific cell
    const response = await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: cellRange,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[value]],
      },
    });

    console.log(`✅ Updated ${fieldName} in Google Sheets at ${cellRange}`);
    return {
      success: true,
      field: fieldName,
      value: value,
      cell: cellRange,
    };
  } catch (error) {
    console.error(`❌ Error updating ${fieldName} in Google Sheets:`, error);
    console.error('Error details:', error.message);
    // Don't throw - allow conversation to continue even if sheet update fails
    return { success: false, error: error.message };
  }
}

/**
 * Save conversation data to Google Sheets (legacy - for end of call)
 * @param {Object} conversationState - ConversationState instance with collected data
 * @returns {Promise<void>}
 */
export async function saveToGoogleSheets(conversationState) {
  try {
    if (!conversationState) {
      throw new Error('ConversationState is required');
    }

    const collectedData = conversationState.getCollectedData();
    const sessionInfo = conversationState.getSessionInfo();

    console.log('📊 Final save to Google Sheets...');
    console.log('📋 Session ID:', sessionInfo.sessionId);
    console.log('📋 Collected Data:', collectedData);

    // If row already exists, update ALL fields at once
    if (conversationState.sheetRowNumber) {
      console.log(`📝 Row ${conversationState.sheetRowNumber} already exists, updating ALL fields`);
      const sheets = await getSheetsClient();

      // Determine status based on confirmation
      const status = sessionInfo.isConfirmed ? 'Confirmed' : 'Partial';

      // Prepare complete row data with ALL fields
      const rowData = [
        sessionInfo.sessionId || '',           // Column A: SessionId
        collectedData.name || '',              // Column B: Stu. Name
        collectedData.phoneNumber || '',       // Column C: Phone Number
        collectedData.programInterest || '',   // Column D: Course
        collectedData.city || '',              // Column E: City
        collectedData.priorEducation || '',    // Column F: Education
        collectedData.intakeYear || '',        // Column G: Intake Year
        collectedData.budget || '',            // Column H: Budget
        status,                                // Column I: Status (Confirmed/Partial)
      ];

      // Detailed logging of each field
      console.log('📊 DETAILED ROW DATA:');
      console.log(`  A - Session ID: "${rowData[0]}"`);
      console.log(`  B - Name: "${rowData[1]}" ${!rowData[1] ? '⚠️ EMPTY' : '✅'}`);
      console.log(`  C - Phone: "${rowData[2]}" ${!rowData[2] ? '⚠️ EMPTY' : '✅'}`);
      console.log(`  D - Course: "${rowData[3]}" ${!rowData[3] ? '⚠️ EMPTY' : '✅'}`);
      console.log(`  E - City: "${rowData[4]}" ${!rowData[4] ? '⚠️ EMPTY' : '✅'}`);
      console.log(`  F - Education: "${rowData[5]}" ${!rowData[5] ? '⚠️ EMPTY' : '✅'}`);
      console.log(`  G - Year: "${rowData[6]}" ${!rowData[6] ? '⚠️ EMPTY' : '✅'}`);
      console.log(`  H - Budget: "${rowData[7]}" ${!rowData[7] ? '⚠️ EMPTY' : '✅'}`);
      console.log(`  I - Status: "${rowData[8]}"`);

      // Update the ENTIRE row at once
      const range = `${SHEET_NAME}!A${conversationState.sheetRowNumber}:I${conversationState.sheetRowNumber}`;

      console.log(`📝 Updating range: ${range}`);

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: range,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [rowData],
        },
      });

      console.log(`✅ Updated entire row ${conversationState.sheetRowNumber} with all fields`);

      return {
        success: true,
        rowNumber: conversationState.sheetRowNumber,
      };
    }

    // If no row exists yet, create one with all data
    const rowNumber = await findOrCreateSessionRow(conversationState);

    // Determine status based on confirmation
    const status = sessionInfo.isConfirmed ? 'Confirmed' : 'Partial';

    // Map collected data to sheet columns
    // Column structure: A=SessionId, B=Stu. Name, C=Phone Number, D=Course, E=City, F=Education, G=Intake Year, H=Budget, I=Status
    const rowData = [
      sessionInfo.sessionId || '',           // Column A: SessionId
      collectedData.name || '',              // Column B: Stu. Name
      collectedData.phoneNumber || '',       // Column C: Phone Number
      collectedData.programInterest || '',   // Column D: Course
      collectedData.city || '',              // Column E: City
      collectedData.priorEducation || '',    // Column F: Education
      collectedData.intakeYear || '',        // Column G: Intake Year
      collectedData.budget || '',            // Column H: Budget
      status,                                // Column I: Status (Confirmed/Partial)
    ];

    // Update the entire row
    const sheets = await getSheetsClient();
    const range = `${SHEET_NAME}!A${rowNumber}:I${rowNumber}`;

    const response = await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: range,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [rowData],
      },
    });

    console.log('✅ Data saved to Google Sheets successfully');
    console.log('📊 Updated range:', response.data.updatedRange);

    return {
      success: true,
      rowNumber: rowNumber,
      updatedRange: response.data.updatedRange,
    };
  } catch (error) {
    console.error('❌ Error saving to Google Sheets:', error);
    console.error('Error details:', error.message);
    if (error.response) {
      console.error('Google Sheets API error:', error.response.data);
    }
    throw error;
  }
}

/**
 * Test Google Sheets connection
 */
export async function testGoogleSheetsConnection() {
  try {
    const sheets = await getSheetsClient();
    const response = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    });

    console.log('✅ Google Sheets connection successful');
    console.log('📊 Spreadsheet title:', response.data.properties?.title);
    return true;
  } catch (error) {
    console.error('❌ Google Sheets connection failed:', error.message);
    return false;
  }
}

/**
 * Get all student data from Google Sheets
 * @returns {Promise<Array>} Array of student objects
 */
export async function getStudentData() {
  try {
    const sheets = await getSheetsClient();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:I`, // All data columns including status
    });

    const rows = response.data.values || [];

    if (rows.length === 0) {
      console.log('📊 No student data found in Google Sheets');
      return [];
    }

    // Skip header row (row 1) and convert data rows to objects
    const data = rows.slice(1); // Skip header row

    // Convert to array of objects
    const students = data
      .filter(row => row && row.length > 0 && row[0]) // Filter out empty rows and rows without session ID
      .map(row => ({
        sessionId: row[0] || '',
        name: row[1] || '',
        phoneNumber: row[2] || '',
        programInterest: row[3] || '',
        city: row[4] || '',
        priorEducation: row[5] || '',
        intakeYear: row[6] || '',
        budget: row[7] || '',
        status: row[8] || 'Partial', // Default to Partial if not set
      }));

    console.log(`📊 Retrieved ${students.length} student records from Google Sheets`);
    return students;
  } catch (error) {
    console.error('❌ Error getting student data from Google Sheets:', error);
    throw error;
  }
}

