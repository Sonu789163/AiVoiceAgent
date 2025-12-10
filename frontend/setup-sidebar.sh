#!/bin/bash

# Sidebar with Routing - Implementation Script
# This script will set up the sidebar navigation with routing

echo "🚀 Setting up Sidebar Navigation with Routing..."
echo ""

cd "/Users/excollodev/Desktop/voice agent/frontend/src"

# Step 1: Backup current App.jsx
echo "📦 Step 1: Backing up current App.jsx..."
cp App.jsx App-backup-$(date +%Y%m%d-%H%M%S).jsx
echo "✅ Backup created"
echo ""

# Step 2: Copy App.jsx to VoiceAgentPage.jsx
echo "📝 Step 2: Creating VoiceAgentPage from current App.jsx..."
cp App.jsx pages/VoiceAgentPage.jsx
echo "✅ VoiceAgentPage.jsx created"
echo ""

# Step 3: Modify VoiceAgentPage.jsx
echo "🔧 Step 3: Modifying VoiceAgentPage.jsx..."

# Change function name from App to VoiceAgentPage and add prop
sed -i '' 's/function App()/function VoiceAgentPage({ onAgentStatusChange })/' pages/VoiceAgentPage.jsx

# Change export
sed -i '' 's/export default App;/export default VoiceAgentPage;/' pages/VoiceAgentPage.jsx

# Add useEffect to notify parent of call status
# This is a bit complex, so we'll add it manually in the guide
echo "⚠️  Manual step needed: Add useEffect to notify parent (see guide below)"
echo ""

# Step 4: Replace App.jsx with routing version
echo "🔄 Step 4: Replacing App.jsx with routing version..."
cp App-with-routing.jsx App.jsx
echo "✅ App.jsx updated with routing"
echo ""

echo "✅ Setup complete!"
echo ""
echo "📝 MANUAL STEPS REQUIRED:"
echo ""
echo "1. Edit pages/VoiceAgentPage.jsx:"
echo "   - Add this code after the state declarations (around line 40):"
echo ""
echo "   // Notify parent when call status changes"
echo "   useEffect(() => {"
echo "     if (onAgentStatusChange) {"
echo "       onAgentStatusChange(isCallActive);"
echo "     }"
echo "   }, [isCallActive, onAgentStatusChange]);"
echo ""
echo "2. Restart the frontend:"
echo "   npm run dev"
echo ""
echo "🎉 After these steps, you'll have a working sidebar with routing!"
