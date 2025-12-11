/**
 * Conversation State Manager
 * Tracks collected information and provides context for the AI agent
 */

export class ConversationState {
  constructor(sessionId = null) {
    this.sessionId = sessionId || Date.now().toString(); // Create session ID using Date.now()
    this.startTime = new Date().toISOString();
    this.endTime = null;
    this.sheetRowNumber = null; // Track which row in Google Sheets this session uses
    this.sessionIdUpdated = false; // Track if session ID has been written to sheet
    this.updateSheetsCallback = null; // Callback function to update Google Sheets (single field)
    this.updateSheetsBatchCallback = null; // Callback function to update Google Sheets (batch)
    this.isConfirmed = false; // Track if user has confirmed all information
    this.collectedData = {
      name: null,
      phoneNumber: null,
      programInterest: null,
      priorEducation: null,
      intakeYear: null,
      city: null,
      budget: null,
    };
  }

  /**
   * Set callback function to update Google Sheets when data is extracted
   * @param {Function} callback - Function to call with (fieldName, value)
   */
  setSheetsUpdateCallback(callback) {
    this.updateSheetsCallback = callback;
  }

  /**
   * Set callback function to update Google Sheets in BATCH
   * @param {Function} callback - Function to call with (conversationState)
   */
  setBatchSheetsUpdateCallback(callback) {
    this.updateSheetsBatchCallback = callback;
  }

  /**
   * Update multiple fields and save to Google Sheets in one go (Batch)
   * @param {Object} updates - Object with keys and values to update
   */
  async updateMultipleFieldsAndSave(updates) {
    let hasChanges = false;
    const changedFields = [];

    for (const [fieldName, value] of Object.entries(updates)) {
      if (this.collectedData[fieldName] !== value) {
        this.collectedData[fieldName] = value;
        hasChanges = true;
        changedFields.push(fieldName);
        console.log(`📝 updateMultipleFieldsAndSave: ${fieldName} = "${value}"`);
      }
    }

    // If values changed and we have a batch callback, update Google Sheets
    // Even if no values changed, if we have new data that might be missing in sheet, force a save?
    // Better to rely on hasChanges to avoid redundant writes, but for safety in this specific "Summary" context,
    // we might want to ensure sync. Let's stick to hasChanges for now to be efficient.

    if (hasChanges && this.updateSheetsBatchCallback) {
      try {
        console.log(`💾 Calling batch updateSheetsBatchCallback for fields: ${changedFields.join(', ')}...`);
        // callback signature: saveToGoogleSheets(conversationState)
        await this.updateSheetsBatchCallback(this);
        console.log('✅ Successfully batch updated Google Sheets');
      } catch (error) {
        console.error('❌ Error executing batch update to Google Sheets:', error);
      }
    } else if (!hasChanges) {
      console.log('ℹ️ Skipping batch save - no new data found in summary');
    }
  }

  /**
   * Update a field and immediately save to Google Sheets
   * @param {string} fieldName - Name of the field
   * @param {*} value - Value to set
   */
  async updateFieldAndSave(fieldName, value) {
    const oldValue = this.collectedData[fieldName];
    this.collectedData[fieldName] = value;

    console.log(`📝 updateFieldAndSave: ${fieldName} = "${value}" (was: "${oldValue || 'empty'}")`);

    // If value changed and we have a callback, update Google Sheets
    if (value && value !== oldValue && this.updateSheetsCallback) {
      try {
        console.log(`💾 Calling updateSheetsCallback for ${fieldName}...`);
        await this.updateSheetsCallback(fieldName, value);
        console.log(`✅ Successfully updated ${fieldName} in Google Sheets`);
      } catch (error) {
        console.error(`❌ Error updating ${fieldName} in Google Sheets:`, error);
        // Don't throw - allow conversation to continue
      }
    } else {
      if (!value) {
        console.log(`⚠️ Skipping save for ${fieldName} - value is empty`);
      } else if (value === oldValue) {
        console.log(`ℹ️ Skipping save for ${fieldName} - value unchanged`);
      } else if (!this.updateSheetsCallback) {
        console.log(`⚠️ Skipping save for ${fieldName} - no callback set`);
      }
    }
  }

  /**
   * Extract information from user message and update state
   * @param {string} userMessage - User's message
   * @param {string} assistantResponse - Assistant's response (for context)
   */
  updateFromMessage(userMessage, assistantResponse = '') {
    const message = userMessage.toLowerCase();

    // Extract name (patterns: "my name is", "i'm", "i am", "call me", "name is")
    if (!this.collectedData.name) {
      const namePatterns = [
        /(?:my name is|i'?m|i am|call me|name is|this is)\s+([a-z]+(?:\s+[a-z]+)?)/i,
        /^([a-z]+(?:\s+[a-z]+)?)(?:\s+here|\s+speaking)/i,
      ];

      for (const pattern of namePatterns) {
        const match = message.match(pattern);
        if (match && match[1]) {
          const name = match[1].trim();
          // Filter out common false positives
          if (!['hello', 'hi', 'yes', 'no', 'okay', 'ok'].includes(name.toLowerCase())) {
            this.collectedData.name = name;
            console.log('📝 Extracted name:', name);
            // Update Google Sheets immediately
            if (this.updateSheetsCallback) {
              this.updateSheetsCallback('name', name).catch(err =>
                console.error('❌ Error updating name in sheets:', err)
              );
            }
            break;
          }
        }
      }
    }

    // Extract phone number
    if (!this.collectedData.phoneNumber) {
      // Remove spaces and dashes for easier matching
      const cleanMessage = message.replace(/[\s-]/g, '');

      // Try to extract 10-digit numbers (allow test numbers starting with 0-5 too)
      let phoneMatch = cleanMessage.match(/(\d{10})/);
      if (phoneMatch && phoneMatch[1]) {
        this.collectedData.phoneNumber = phoneMatch[1];
        console.log('📝 Extracted phone number:', phoneMatch[1]);
      } else {
        // Try with +91 prefix
        phoneMatch = cleanMessage.match(/(?:\+91)?(\d{10})/);
        if (phoneMatch && phoneMatch[1]) {
          this.collectedData.phoneNumber = phoneMatch[1];
          console.log('📝 Extracted phone number:', phoneMatch[1]);
        } else {
          // Try any 9-10 digit sequence (might be missing first digit)
          phoneMatch = message.match(/(\d{9,10})/);
          if (phoneMatch && phoneMatch[1]) {
            const phone = phoneMatch[1];
            // If 9 digits, might be missing leading digit - try to validate
            if (phone.length === 9 && /^[6-9]/.test(phone)) {
              // Could be valid, but we prefer 10 digits
              // Only use if it's clearly a phone number context
              if (message.match(/phone|number|mobile|contact/i)) {
                this.collectedData.phoneNumber = phone;
                console.log('📝 Extracted phone number (9 digits):', phone);
              }
            } else if (phone.length === 10 && /^[6-9]/.test(phone)) {
              this.collectedData.phoneNumber = phone;
              console.log('📝 Extracted phone number:', phone);
              // Update Google Sheets immediately
              if (this.updateSheetsCallback) {
                this.updateSheetsCallback('phoneNumber', phone).catch(err =>
                  console.error('❌ Error updating phone in sheets:', err)
                );
              }
            }
          }
        }
      }

      // Also try patterns with context words
      if (!this.collectedData.phoneNumber) {
        const contextPatterns = [
          /phone.*?(\d{9,10})/i,
          /number.*?(\d{9,10})/i,
          /mobile.*?(\d{9,10})/i,
        ];

        for (const pattern of contextPatterns) {
          const match = message.match(pattern);
          if (match && match[1]) {
            const phone = match[1].replace(/[\s-]/g, '');
            if (phone.length >= 9 && /^[6-9]/.test(phone)) {
              // Pad to 10 digits if needed (add leading digit)
              this.collectedData.phoneNumber = phone.length === 9 ? '9' + phone : phone;
              console.log('📝 Extracted phone number:', this.collectedData.phoneNumber);
              // Update Google Sheets immediately
              if (this.updateSheetsCallback) {
                this.updateSheetsCallback('phoneNumber', this.collectedData.phoneNumber).catch(err =>
                  console.error('❌ Error updating phone in sheets:', err)
                );
              }
              break;
            }
          }
        }
      }
    }

    // Extract program interest
    if (!this.collectedData.programInterest) {
      const interestKeywords = {
        'culinary': ['culinary', 'cooking', 'chef', 'kitchen', 'culinary arts', 'culinary art'],
        'front office': ['front office', 'reception', 'front desk', 'frontoffice'],
        'housekeeping': ['housekeeping', 'house keeping', 'house-keeping'],
        'food and beverage': ['food and beverage', 'food beverage', 'food & beverage', 'f&b', 'restaurant', 'f and b'],
        'hospitality': ['hospitality', 'hotel management', 'hotel'],
      };

      // Check for exact matches first (longer phrases)
      for (const [interest, keywords] of Object.entries(interestKeywords)) {
        // Sort keywords by length (longest first) to match longer phrases first
        const sortedKeywords = keywords.sort((a, b) => b.length - a.length);
        for (const keyword of sortedKeywords) {
          if (message.includes(keyword.toLowerCase())) {
            this.collectedData.programInterest = interest;
            console.log('📝 Extracted program interest:', interest, 'from keyword:', keyword);
            // Update Google Sheets immediately
            if (this.updateSheetsCallback) {
              this.updateSheetsCallback('programInterest', interest).catch(err =>
                console.error('❌ Error updating interest in sheets:', err)
              );
            }
            break;
          }
        }
        if (this.collectedData.programInterest) break;
      }
    }

    // Extract prior education
    if (!this.collectedData.priorEducation) {
      if (message.match(/\b(12th|twelfth|12|twelve|high school|hsc)\b/i)) {
        this.collectedData.priorEducation = '12th';
        console.log('📝 Extracted prior education: 12th');
        // Update Google Sheets immediately
        if (this.updateSheetsCallback) {
          this.updateSheetsCallback('priorEducation', '12th').catch(err =>
            console.error('❌ Error updating education in sheets:', err)
          );
        }
      } else if (message.match(/\b(graduate|graduation|degree|bachelor|b\.?a\.?|b\.?com|b\.?sc)\b/i)) {
        this.collectedData.priorEducation = 'Graduate';
        console.log('📝 Extracted prior education: Graduate');
        // Update Google Sheets immediately
        if (this.updateSheetsCallback) {
          this.updateSheetsCallback('priorEducation', 'Graduate').catch(err =>
            console.error('❌ Error updating education in sheets:', err)
          );
        }
      }
    }

    // Extract intake year
    if (!this.collectedData.intakeYear) {
      // Match years 2024-2099
      const yearMatch = message.match(/\b(20[2-9][0-9])\b/);
      if (yearMatch) {
        const year = parseInt(yearMatch[1]);
        if (year >= 2024 && year <= 2099) {
          this.collectedData.intakeYear = yearMatch[1];
          console.log('📝 Extracted intake year:', yearMatch[1]);
          // Update Google Sheets immediately
          if (this.updateSheetsCallback) {
            this.updateSheetsCallback('intakeYear', yearMatch[1]).catch(err =>
              console.error('❌ Error updating year in sheets:', err)
            );
          }
        }
      } else if (message.match(/\b(next year|coming year)\b/i)) {
        // Default to next year if mentioned
        this.collectedData.intakeYear = String(new Date().getFullYear() + 1);
        console.log('📝 Extracted intake year: Next year');
        // Update Google Sheets immediately
        if (this.updateSheetsCallback) {
          this.updateSheetsCallback('intakeYear', this.collectedData.intakeYear).catch(err =>
            console.error('❌ Error updating year in sheets:', err)
          );
        }
      }
    }

    // Extract city
    if (!this.collectedData.city) {
      // Extensive list of Indian cities (Tier 1, 2, 3)
      const cities = [
        // Tier 1
        'mumbai', 'delhi', 'bangalore', 'bengaluru', 'hyderabad', 'chennai', 'kolkata', 'pune', 'ahmedabad',
        // Tier 2/3 & others
        'jaipur', 'lucknow', 'kanpur', 'nagpur', 'indore', 'thane', 'bhopal', 'visakhapatnam', 'patna', 'vadodara',
        'ghaziabad', 'ludhiana', 'agra', 'nashik', 'faridabad', 'meerut', 'rajkot', 'varanasi', 'srinagar', 'amritsar',
        'jodhpur', 'raipur', 'coimbatore', 'kochi', 'cochin', 'thiruvananthapuram', 'trivandrum', 'madurai', 'jamshedpur',
        'ranchi', 'guwahati', 'bhubaneswar', 'cuttack', 'dehradun', 'mysore', 'mysuru', 'shimla', 'gurgaon', 'gurugram',
        'noida', 'chandigarh', 'surat', 'aurangabad', 'navi mumbai', 'allahabad', 'prayagraj', 'howrah', 'jabalpur',
        'gwalior', 'vijayawada', 'jalandhar', 'kota', 'udaipur', 'ajmer', 'bikaner', 'akola', 'latur', 'dhule',
        'ahmednagar', 'chandrapur', 'parbhani', 'jalgaon', 'jalna', 'nanded', 'solapur', 'kolhapur', 'sangli',
        'satara', 'ratnagiri', 'sindhudurg', 'panjim', 'panaji', 'margao', 'vasco', 'siliguri', 'durgapur', 'asansol',
        'kharagpur', 'haldia', 'dhanbad', 'bokaro', 'hazaribagh', 'giridih', 'ramgarh', 'phagwara', 'hoshiarpur',
        'pathankot', 'mohali', 'panchkula', 'rohtak', 'hisar', 'karnal', 'panipat', 'sonipat', 'ambala', 'yamunanagar',
        'kurukshetra', 'kaithal', 'sirsa', 'fatehabad', 'jind', 'bhiwani', 'charkhi dadri', 'mahendragarh', 'rewari',
        'jhajjar', 'nu'
      ];

      // Check for exact matches
      for (const city of cities) {
        // Use word boundary to avoid partial matches (e.g. "goa" in "goal")
        const regex = new RegExp(`\\b${city}\\b`, 'i');
        if (regex.test(message)) {
          this.collectedData.city = city.charAt(0).toUpperCase() + city.slice(1);
          console.log('📝 Extracted city:', this.collectedData.city);
          // Update Google Sheets immediately
          if (this.updateSheetsCallback) {
            this.updateSheetsCallback('city', this.collectedData.city).catch(err =>
              console.error('❌ Error updating city in sheets:', err)
            );
          }
          break;
        }
      }

      // Context-based extraction for cities not in list
      if (!this.collectedData.city) {
        const cityPatterns = [
          /(?:i am from|i'm from|i live in|my city is|location is)\s+([a-z]+)/i,
        ];

        for (const pattern of cityPatterns) {
          const match = message.match(pattern);
          if (match && match[1]) {
            const potentialCity = match[1].trim();
            // Basic validation to avoid common words
            if (potentialCity.length > 3 && !['here', 'there', 'home', 'india'].includes(potentialCity.toLowerCase())) {
              this.collectedData.city = potentialCity.charAt(0).toUpperCase() + potentialCity.slice(1);
              console.log('📝 Extracted city (context):', this.collectedData.city);
              if (this.updateSheetsCallback) {
                this.updateSheetsCallback('city', this.collectedData.city).catch(err =>
                  console.error('❌ Error updating city in sheets:', err)
                );
              }
              break;
            }
          }
        }
      }
    }

    // Extract budget
    if (!this.collectedData.budget) {
      // Helper to convert word numbers to digits
      const wordToNum = (str) => {
        const words = {
          'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
          'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
          'eleven': 11, 'twelve': 12, 'fifteen': 15, 'twenty': 20,
          'thirty': 30, 'forty': 40, 'fifty': 50
        };
        return words[str.toLowerCase()] || str;
      };

      // Patterns: "5 lakhs", "five lakhs", "5.5 lakhs", etc.
      const budgetPatterns = [
        /((?:\d+(?:\.\d+)?)|(?:one|two|three|four|five|six|seven|eight|nine|ten))\s*(?:lakh|lac|L)\b/i,
        /budget.*?((?:\d+(?:\.\d+)?)|(?:one|two|three|four|five|six|seven|eight|nine|ten))/i,
      ];

      for (const pattern of budgetPatterns) {
        const match = message.match(pattern);
        if (match && match[1]) {
          let valueStr = match[1];
          let multiplier = 100000; // Default to lakhs context

          // Convert word to number if possible
          let value = parseFloat(wordToNum(valueStr));

          if (!isNaN(value)) {
            // If value is small (< 100) and followed by "lakh", multiply
            // If value is large (> 1000), treat as absolute rupees
            if (message.match(/lakh|lac|L/i)) {
              value = value * 100000;
            } else if (value < 100) {
              // If user just says "5" in response to budget question, assume lakhs
              value = value * 100000;
            }

            this.collectedData.budget = String(Math.floor(value));
            console.log('📝 Extracted budget:', this.collectedData.budget);
            // Update Google Sheets immediately
            if (this.updateSheetsCallback) {
              this.updateSheetsCallback('budget', this.collectedData.budget).catch(err =>
                console.error('❌ Error updating budget in sheets:', err)
              );
            }
            break;
          }
        }
      }
    }
  }

  /**
   * Get context string for system prompt
   * @returns {string} Context about collected information
   */
  getContextString() {
    const collected = [];
    const missing = [];

    // Define the order of fields to collect
    const fieldOrder = [
      { key: 'name', label: 'Name' },
      { key: 'phoneNumber', label: 'Phone Number' },
      { key: 'programInterest', label: 'Program Interest' },
      { key: 'priorEducation', label: 'Prior Education' },
      { key: 'intakeYear', label: 'Intake Year' },
      { key: 'city', label: 'City' },
      { key: 'budget', label: 'Budget' }
    ];

    // Check each field in order
    for (const field of fieldOrder) {
      if (this.collectedData[field.key]) {
        collected.push(`${field.label}: ${this.collectedData[field.key]}`);
      } else {
        missing.push(field.label);
      }
    }

    let context = '';

    if (collected.length > 0) {
      context += `\n\n### 📋 COLLECTED INFORMATION SO FAR:\n${collected.join('\n')}\n`;
    }

    if (missing.length > 0) {
      // Find the FIRST missing field in the sequence
      const nextField = missing[0];

      context += `\n### 🎯 STILL NEED TO COLLECT (in order):\n${missing.join(', ')}\n`;
      context += `\n**NEXT QUESTION (Ask for THIS ONLY):** ${nextField}\n`;
      context += `**IMPORTANT**: Ask for "${nextField}" now. Don't ask for multiple fields at once!\n`;
    } else {
      context += `\n### ✅ ALL INFORMATION COLLECTED!\n`;
      context += `\n**MANDATORY NEXT STEP**: You MUST now read back ALL the collected information to the user and ask for confirmation.\n`;
      context += `Say something like: "Great! Let me confirm everything: [list all 7 fields]. Is this all correct?"\n`;
      context += `Wait for user confirmation before ending the conversation.\n`;
    }

    return context;
  }

  /**
   * Get collected data as object
   * @returns {Object} Collected data
   */
  getCollectedData() {
    return { ...this.collectedData };
  }

  /**
   * Get summary of collected data for logging
   * @returns {string} Summary string
   */
  getDataSummary() {
    const data = this.collectedData;
    const fields = [];
    if (data.name) fields.push(`Name: ${data.name}`);
    if (data.phoneNumber) fields.push(`Phone: ${data.phoneNumber}`);
    if (data.programInterest) fields.push(`Interest: ${data.programInterest}`);
    if (data.city) fields.push(`City: ${data.city}`);
    if (data.intakeYear) fields.push(`Year: ${data.intakeYear}`);
    if (data.priorEducation) fields.push(`Education: ${data.priorEducation}`);
    if (data.budget) fields.push(`Budget: ${data.budget}`);
    return fields.length > 0 ? fields.join(', ') : 'No data collected yet';
  }

  /**
   * Reset conversation state
   */
  /**
   * Close the session
   */
  closeSession() {
    this.endTime = new Date().toISOString();
    console.log(`🔄 Session ${this.sessionId} closed at ${this.endTime}`);
  }

  /**
   * Get session information
   */
  getSessionInfo() {
    return {
      sessionId: this.sessionId,
      startTime: this.startTime,
      endTime: this.endTime,
      isConfirmed: this.isConfirmed,
    };
  }

  /**
   * Check if all required data has been collected
   * @returns {boolean} True if all fields are filled
   */
  isAllDataCollected() {
    return !!(
      this.collectedData.name &&
      this.collectedData.phoneNumber &&
      this.collectedData.programInterest &&
      this.collectedData.priorEducation &&
      this.collectedData.intakeYear &&
      this.collectedData.city &&
      this.collectedData.budget
    );
  }

  /**
   * Mark the data as confirmed by the user
   */
  markAsConfirmed() {
    this.isConfirmed = true;
    console.log(`✅ Session ${this.sessionId} data marked as CONFIRMED by user`);
  }

  /**
   * Extract confirmed data from the AI's summary block
   * This acts as a fail-safe to catch any data the regex might have missed
   * @param {string} response - The full text response from the assistant
   */
  updateFromAssistantResponse(response) {
    if (!response) return;

    // Look for the bulleted list lines (e.g., "- Name: John" or "* Phone: 123...")
    const lines = response.split('\n');
    let foundSummary = false;
    const batchUpdates = {};

    for (const line of lines) {
      const cleanLine = line.trim();

      // Match pattern: "- Label: Value" (allows -, *, • or nothing at start, AND indentation)
      // Fix: Added ^\s* to allow leading spaces before bullet
      // Capture groups: 1=Label, 2=Value
      const match = cleanLine.match(/^\s*[-*•]?\s*([a-zA-Z\s]+):\s*(.+)$/);

      if (match) {
        foundSummary = true;
        const key = match[1].toLowerCase().trim();
        const value = match[2].trim();

        console.log(`🔍 Parsed Summary Line: Key="${key}", Value="${value}"`);

        // Skip if value is empty or just placeholders
        if (!value || value === '-' || value === 'N/A') continue;

        // Collect updates in an object
        // CRITICAL FIX: Always overwrite with summary data as it is the "Gold Standard"
        // Previous logic only updated if field was empty, which kept garbage data (e.g. Name="studying in")

        if (key.includes('name') || key.includes('naam')) {
          batchUpdates.name = value;
        }
        else if (key.includes('phone') || key.includes('mobile')) {
          // Clean phone number if needed (keep digits)
          const cleanPhone = value.replace(/\D/g, '');
          const finalPhone = cleanPhone.length >= 10 ? cleanPhone : value;
          batchUpdates.phoneNumber = finalPhone;
        }
        else if (key.includes('course') || key.includes('program')) {
          batchUpdates.programInterest = value;
        }
        else if (key.includes('education') || key.includes('qualification') || key.includes('barahvi')) {
          batchUpdates.priorEducation = value;
        }
        else if (key.includes('year') || key.includes('saal') || key.includes('intake')) {
          batchUpdates.intakeYear = value;
        }
        else if (key.includes('city') || key.includes('location')) {
          batchUpdates.city = value;
        }
        else if (key.includes('budget')) {
          batchUpdates.budget = value;
        }
      } else {
        // Debug log for non-matching lines (helps debug silent failures)
        // Only log if it looks like a list item to avoid noise
        if (line.includes(':')) {
          console.log(`⚠️ Skiping line (no regex match): "${cleanLine}"`);
        }
      }
    }

    console.log(`✅ Summary Parse Complete. Found ${Object.keys(batchUpdates).length} updates.`);

    if (foundSummary) {
      console.log('✅ Processed AI summary. Batch updates:', batchUpdates);
      // Perform a single batch update for all collected fields
      if (Object.keys(batchUpdates).length > 0) {
        this.updateMultipleFieldsAndSave(batchUpdates);
      }
    }
  }

  reset() {
    // Create new session ID for reset
    this.sessionId = Date.now().toString();
    this.startTime = new Date().toISOString();
    this.endTime = null;
    this.collectedData = {
      name: null,
      phoneNumber: null,
      programInterest: null,
      priorEducation: null,
      intakeYear: null,
      city: null,
      budget: null,
    };
    console.log('🔄 Conversation state reset with new session:', this.sessionId);
  }
}



