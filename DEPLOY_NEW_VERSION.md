# 🚀 DEPLOY NEW VERSION WITHOUT AFFECTING PRODUCTION

## 🎯 **Goal**

Deploy your new code (with ngrok TTS) to **NEW URLs** while keeping your existing production deployment untouched.

---

## 📋 **Strategy**

### **Current Setup:**
- **Main branch** → Production (existing deployment)
- **New branch** → New deployment (separate URLs)

### **Result:**
- ✅ Production stays on main branch (unchanged)
- ✅ New version on new branch (new URLs)
- ✅ Both deployments work independently

---

## 🔧 **Step-by-Step Guide**

### **Step 1: Create New Branch**

```bash
cd "/Users/excollodev/Desktop/Stt-model/voice agent"

# Create and switch to new branch
git checkout -b ngrok-tts-version

# Verify you're on new branch
git branch
# Should show: * ngrok-tts-version
```

---

### **Step 2: Commit Your Changes**

```bash
# Add all changes
git add .

# Commit with descriptive message
git commit -m "feat: Add ngrok TTS integration for testing"

# Push to new branch
git push origin ngrok-tts-version
```

---

### **Step 3: Deploy Backend to Render (New Service)**

#### **Option A: Create New Web Service (Recommended)**

1. **Go to Render Dashboard:** https://dashboard.render.com
2. **Click "New +" → "Web Service"**
3. **Connect Repository** (same repo as before)
4. **Configure:**
   - **Name:** `voice-agent-backend-ngrok` (different from production)
   - **Branch:** `ngrok-tts-version` ✅ (NOT main)
   - **Root Directory:** `voice agent/backend`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free

5. **Environment Variables:**
   ```
   OPENAI_API_KEY=your_key
   SARVAM_API_KEY=your_key
   NODE_ENV=production
   ```

6. **Click "Create Web Service"**

7. **Get New Backend URL:**
   ```
   https://voice-agent-backend-ngrok.onrender.com
   ```

#### **Option B: Use Same Service with Branch Deploy**

1. Go to your existing backend service
2. Click "Manual Deploy" → "Deploy branch"
3. Select `ngrok-tts-version`
4. **Note:** This will replace production temporarily

**❌ Not recommended** - Use Option A instead

---

### **Step 4: Deploy Frontend to Vercel (New Project)**

#### **Create New Vercel Project**

1. **Go to Vercel Dashboard:** https://vercel.com/dashboard
2. **Click "Add New..." → "Project"**
3. **Import Same Repository**
4. **Configure:**
   - **Project Name:** `voice-agent-ngrok` (different from production)
   - **Framework Preset:** Vite
   - **Root Directory:** `voice agent/frontend`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
   - **Install Command:** `npm install`

5. **Git Branch:**
   - **Production Branch:** `ngrok-tts-version` ✅ (NOT main)

6. **Environment Variables:**
   ```
   VITE_BACKEND_URL=https://voice-agent-backend-ngrok.onrender.com
   ```

7. **Click "Deploy"**

8. **Get New Frontend URL:**
   ```
   https://voice-agent-ngrok.vercel.app
   ```

---

### **Step 5: Update URLs in Code**

#### **Update Backend URL in Frontend**

**File:** `/voice agent/frontend/src/App.jsx`

```javascript
// Find WebSocket connection (around line 100-150)
// BEFORE
const WS_URL = 'ws://localhost:8080/connection';

// AFTER (use your Render backend URL)
const WS_URL = 'wss://voice-agent-backend-ngrok.onrender.com/connection';
```

**Commit and push:**
```bash
git add .
git commit -m "fix: Update backend URL for ngrok deployment"
git push origin ngrok-tts-version
```

**Vercel will auto-deploy** the update.

---

### **Step 6: Verify Both Deployments**

#### **Production (Main Branch):**
- **Frontend:** https://your-prod-frontend.vercel.app
- **Backend:** https://your-prod-backend.onrender.com
- **Branch:** main
- **Status:** ✅ Unchanged, still working

#### **New Version (ngrok-tts-version Branch):**
- **Frontend:** https://voice-agent-ngrok.vercel.app
- **Backend:** https://voice-agent-backend-ngrok.onrender.com
- **Branch:** ngrok-tts-version
- **Status:** ✅ New deployment, using ngrok TTS

---

## 📊 **Deployment Comparison**

| Aspect | Production | New Version |
|--------|------------|-------------|
| **Branch** | main | ngrok-tts-version |
| **Frontend URL** | your-prod.vercel.app | voice-agent-ngrok.vercel.app |
| **Backend URL** | your-prod.onrender.com | voice-agent-backend-ngrok.onrender.com |
| **TTS** | Local/Old | ngrok TTS |
| **Status** | ✅ Unchanged | ✅ New deployment |

---

## 🔄 **Git Workflow**

```
main (production)
  │
  ├─ Deployed to:
  │   - Frontend: your-prod.vercel.app
  │   - Backend: your-prod.onrender.com
  │
  └─ ngrok-tts-version (new)
      │
      └─ Deployed to:
          - Frontend: voice-agent-ngrok.vercel.app
          - Backend: voice-agent-backend-ngrok.onrender.com
```

---

## ✅ **Checklist**

### **Before Deployment:**
- [ ] Create new branch: `ngrok-tts-version`
- [ ] Update TTS URL to ngrok in `clonedVoice.js`
- [ ] Commit and push to new branch

### **Backend (Render):**
- [ ] Create new web service (not update existing)
- [ ] Set branch to `ngrok-tts-version`
- [ ] Add environment variables
- [ ] Get new backend URL

### **Frontend (Vercel):**
- [ ] Create new project (not update existing)
- [ ] Set branch to `ngrok-tts-version`
- [ ] Update WebSocket URL to new backend
- [ ] Commit and push
- [ ] Get new frontend URL

### **Testing:**
- [ ] Test new deployment works
- [ ] Verify production still works
- [ ] Both deployments independent

---

## 🎯 **Commands Summary**

```bash
# 1. Create new branch
git checkout -b ngrok-tts-version

# 2. Commit changes
git add .
git commit -m "feat: Add ngrok TTS integration"
git push origin ngrok-tts-version

# 3. Deploy to Render (manual - use dashboard)
# Create NEW web service, select ngrok-tts-version branch

# 4. Deploy to Vercel (manual - use dashboard)
# Create NEW project, select ngrok-tts-version branch

# 5. Update frontend with backend URL
# Edit App.jsx, commit, push
git add .
git commit -m "fix: Update backend URL"
git push origin ngrok-tts-version
```

---

## 💡 **Important Notes**

### **1. Don't Merge to Main**

```bash
# ❌ DON'T DO THIS (will affect production)
git checkout main
git merge ngrok-tts-version

# ✅ DO THIS (keep separate)
# Keep ngrok-tts-version as separate branch
# Production stays on main
```

### **2. Separate Deployments**

- **Render:** Create **NEW web service** (not update existing)
- **Vercel:** Create **NEW project** (not update existing)
- This ensures production is untouched

### **3. Branch-Based Deployment**

- **Main branch** → Production deployment
- **ngrok-tts-version branch** → New deployment
- Each branch deploys to different URLs

---

## 🔄 **Future Updates**

### **Update New Version:**
```bash
# Switch to new branch
git checkout ngrok-tts-version

# Make changes
# ...

# Commit and push
git add .
git commit -m "update: ..."
git push origin ngrok-tts-version

# Render and Vercel auto-deploy
```

### **Update Production:**
```bash
# Switch to main
git checkout main

# Make changes
# ...

# Commit and push
git add .
git commit -m "update: ..."
git push origin main

# Production auto-deploys
```

---

## 🎉 **Result**

After following these steps, you'll have:

1. ✅ **Production** (main branch)
   - Frontend: your-prod.vercel.app
   - Backend: your-prod.onrender.com
   - **Unchanged, still working**

2. ✅ **New Version** (ngrok-tts-version branch)
   - Frontend: voice-agent-ngrok.vercel.app
   - Backend: voice-agent-backend-ngrok.onrender.com
   - **New deployment, using ngrok TTS**

3. ✅ **Both work independently**
   - No interference
   - Separate URLs
   - Separate branches

---

## 📚 **Next Steps**

1. **Create branch:** `git checkout -b ngrok-tts-version`
2. **Push to GitHub:** `git push origin ngrok-tts-version`
3. **Deploy to Render:** Create new web service
4. **Deploy to Vercel:** Create new project
5. **Test both:** Verify production + new version work

---

**Your production will remain untouched!** 🎉🚀
