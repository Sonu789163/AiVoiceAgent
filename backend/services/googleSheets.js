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
const RANGE = 'A:H'; // Columns A to H (Session, Student Name, Phone Number, Interest subject, Phone no., City, Education, Intake Year)

/**
 * Initialize Google Sheets API client
 */
async function getSheetsClient() {
  try {
    // Path to service account credentials
    // Try multiple possible paths
    const possiblePaths = [
      process.env.GOOGLE_SERVICE_ACCOUNT_PATH,
      '/Users/excollodev/Downloads/resolute-tracer-469504-r8-a1b7b9ac074a.json', // Absolute path
      join(__dirname, '../../Downloads/resolute-tracer-469504-r8-a1b7b9ac074a.json'),
      join(process.cwd(), 'resolute-tracer-469504-r8-a1b7b9ac074a.json'),
      join(process.cwd(), 'backend/resolute-tracer-469504-r8-a1b7b9ac074a.json'),
    ];

    let credentialsPath = null;
    let credentials = null;

    // Try to find the credentials file
    for (const path of possiblePaths) {
      if (!path) continue;
      try {
        const fullPath = path.startsWith('/') ? path : join(process.cwd(), path);
        credentials = JSON.parse(readFileSync(fullPath, 'utf8'));
        credentialsPath = fullPath;
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

    if (!credentials) {
      throw new Error('Google service account credentials file not found. Please set GOOGLE_SERVICE_ACCOUNT_PATH or place the JSON file in the expected location.');
    }

    // Create auth client
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });

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

    // Create new row by appending empty row (8 columns: Session, Student Name, Phone Number, Interest, Phone no., City, Education, Year)
    const emptyRow = ['', '', '', '', '', '', '', '']; // 8 empty cells
    const appendResponse = await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:H`, // Updated to include all 8 columns
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      resource: {
        values: [emptyRow],
      },
    });

    // Extract row number from the updated range
    // Format: "Sheet1!A2:H2" -> row 2
    const updatedRange = appendResponse.data.updates?.updatedRange;
    if (updatedRange) {
      const rowMatch = updatedRange.match(/(\d+)/);
      if (rowMatch) {
        const rowNumber = parseInt(rowMatch[1]);
        conversationState.sheetRowNumber = rowNumber;
        console.log(`📝 Created NEW row ${rowNumber} for NEW session ${sessionId}`);
        console.log(`📝 Total rows in sheet before this: ${rows.length}`);
        console.log(`📝 This is session #${rows.length} (excluding header)`);

        // Immediately set the session ID in column A
        try {
          await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A${rowNumber}`,
            valueInputOption: 'USER_ENTERED',
            resource: {
              values: [[sessionId]],
            },
          });
          conversationState.sessionIdUpdated = true;
          console.log(`📝 Set Session ID in row ${rowNumber}`);
        } catch (error) {
          console.error('❌ Error setting session ID:', error);
        }

        return rowNumber;
      }
    }

    // Fallback: calculate row number from existing rows (ensure it's at least row 2)
    const newRowNumber = Math.max(DATA_START_ROW, rows.length + 1);
    conversationState.sheetRowNumber = newRowNumber;
    console.log(`📝 Using row ${newRowNumber} for session ${sessionId}`);
    return newRowNumber;
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
    // A=SessionId, B=Stu. Name, C=Phone Number, D=Course, E=Phone no., F=City, G=Education, H=Intake Year
    const fieldToColumn = {
      'sessionId': 'A',        // SessionId (Column A)
      'name': 'B',             // Stu. Name (Column B)
      'phoneNumber': 'C',      // Phone Number (Column C)
      'programInterest': 'D',  // Course (Column D)
      'city': 'F',             // City (Column F)
      'priorEducation': 'G',   // Education (Column G)
      'intakeYear': 'H',       // Intake Year (Column H)
      'budget': 'I',           // Budget (Column I) - adding new column
      // Note: Column E (Phone no.) is duplicate of C, we'll update both
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

    // If updating phone number, also update column E (Phone no.)
    if (fieldName === 'phoneNumber' && column === 'C') {
      const phoneNoCellRange = `${SHEET_NAME}!E${rowNumber}`;
      const sheets = await getSheetsClient();
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: phoneNoCellRange,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [[value]],
        },
      });
      console.log(`📝 Also updated Phone no. in ${phoneNoCellRange}`);
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

    // If row already exists, just ensure all fields are updated
    if (conversationState.sheetRowNumber) {
      console.log(`📝 Row ${conversationState.sheetRowNumber} already exists, ensuring all fields are updated`);

      // Ensure session ID is set
      if (!conversationState.sessionIdUpdated) {
        const sessionCellRange = `${SHEET_NAME}!A${conversationState.sheetRowNumber}`;
        const sheets = await getSheetsClient();
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: sessionCellRange,
          valueInputOption: 'USER_ENTERED',
          resource: {
            values: [[sessionInfo.sessionId]],
          },
        });
        conversationState.sessionIdUpdated = true;
        console.log(`📝 Set Session ID in ${sessionCellRange}`);
      }

      // Update any missing fields
      const fields = [
        { name: 'name', value: collectedData.name },
        { name: 'phoneNumber', value: collectedData.phoneNumber },
        { name: 'programInterest', value: collectedData.programInterest },
        { name: 'city', value: collectedData.city },
        { name: 'priorEducation', value: collectedData.priorEducation },
        { name: 'intakeYear', value: collectedData.intakeYear },
      ];

      for (const field of fields) {
        if (field.value) {
          await updateFieldInGoogleSheets(conversationState, field.name, field.value);
        }
      }

      return {
        success: true,
        rowNumber: conversationState.sheetRowNumber,
      };
    }

    // If no row exists yet, create one with all data
    const rowNumber = await findOrCreateSessionRow(conversationState);

    // Map collected data to sheet columns
    // Column structure: A=SessionId, B=Stu. Name, C=Phone Number, D=Course, E=Phone no., F=City, G=Education, H=Intake Year, I=Budget
    const rowData = [
      sessionInfo.sessionId || '',           // Column A: SessionId
      collectedData.name || '',              // Column B: Stu. Name
      collectedData.phoneNumber || '',       // Column C: Phone Number
      collectedData.programInterest || '',   // Column D: Course
      collectedData.phoneNumber || '',       // Column E: Phone no. (duplicate of C)
      collectedData.city || '',              // Column F: City
      collectedData.priorEducation || '',    // Column G: Education
      collectedData.intakeYear || '',        // Column H: Intake Year
      collectedData.budget || '',            // Column I: Budget
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

