# ✅ DEPLOYMENT CHECKLIST - New Version

## 🎉 **Branch Created & Pushed!**

Your new branch `ngrok-tts-version` is now on GitHub!

**Repository:** https://github.com/Sonu789163/AiVoiceAgent  
**Branch:** ngrok-tts-version

---

## 📋 **Next Steps**

### **Step 1: Deploy Backend to Render** ✅

1. **Go to Render:** https://dashboard.render.com

2. **Create NEW Web Service:**
   - Click "New +" → "Web Service"
   - Connect to: `Sonu789163/AiVoiceAgent`
   - **Name:** `voice-agent-backend-ngrok`
   - **Branch:** `ngrok-tts-version` ⚠️ (NOT main!)
   - **Root Directory:** `voice agent/backend`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free

3. **Environment Variables:**
   ```
   OPENAI_API_KEY=your_openai_key
   SARVAM_API_KEY=your_sarvam_key
   NODE_ENV=production
   ```

4. **Deploy!**

5. **Copy Backend URL:**
   ```
   https://voice-agent-backend-ngrok.onrender.com
   ```

---

### **Step 2: Update Frontend with Backend URL** ⏳

**File:** `/voice agent/frontend/src/App.jsx`

Find the WebSocket connection (around line 100-150):

```javascript
// FIND THIS
const WS_URL = 'ws://localhost:8080/connection';

// REPLACE WITH (use your Render backend URL)
const WS_URL = 'wss://voice-agent-backend-ngrok.onrender.com/connection';
```

**Commit and push:**
```bash
cd "/Users/excollodev/Desktop/Stt-model/voice agent"
git add frontend/src/App.jsx
git commit -m "fix: Update backend URL for ngrok deployment"
git push origin ngrok-tts-version
```

---

### **Step 3: Deploy Frontend to Vercel** ⏳

1. **Go to Vercel:** https://vercel.com/dashboard

2. **Create NEW Project:**
   - Click "Add New..." → "Project"
   - Import: `Sonu789163/AiVoiceAgent`
   - **Project Name:** `voice-agent-ngrok`
   - **Framework:** Vite
   - **Root Directory:** `voice agent/frontend`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`

3. **Git Configuration:**
   - **Production Branch:** `ngrok-tts-version` ⚠️ (NOT main!)

4. **Environment Variables:**
   ```
   VITE_BACKEND_URL=https://voice-agent-backend-ngrok.onrender.com
   ```

5. **Deploy!**

6. **Copy Frontend URL:**
   ```
   https://voice-agent-ngrok.vercel.app
   ```

---

## 📊 **Your Deployments**

### **Production (Unchanged)** ✅
- **Branch:** main
- **Frontend:** https://ai-voice-agent-omega.vercel.app (or your prod URL)
- **Backend:** https://aivoiceagent.onrender.com (or your prod URL)
- **Status:** ✅ Still working, untouched

### **New Version (ngrok TTS)** 🆕
- **Branch:** ngrok-tts-version
- **Frontend:** https://voice-agent-ngrok.vercel.app
- **Backend:** https://voice-agent-backend-ngrok.onrender.com
- **Status:** 🚀 New deployment

---

## ✅ **Deployment Checklist**

- [x] Create new branch: `ngrok-tts-version`
- [x] Commit changes
- [x] Push to GitHub
- [ ] Deploy backend to Render (NEW service)
- [ ] Get backend URL
- [ ] Update frontend with backend URL
- [ ] Commit and push frontend update
- [ ] Deploy frontend to Vercel (NEW project)
- [ ] Get frontend URL
- [ ] Test new deployment
- [ ] Verify production still works

---

## 🎯 **Important Reminders**

### **1. Create NEW Services (Not Update Existing)**

**Render:**
- ❌ Don't update existing backend
- ✅ Create NEW web service

**Vercel:**
- ❌ Don't update existing frontend
- ✅ Create NEW project

### **2. Use Correct Branch**

Both Render and Vercel should use:
- **Branch:** `ngrok-tts-version` ✅
- **NOT:** main ❌

### **3. WebSocket URL**

Frontend should use:
- **Format:** `wss://` (not `ws://`)
- **URL:** Your Render backend URL
- **Example:** `wss://voice-agent-backend-ngrok.onrender.com/connection`

---

## 🔍 **Verification**

### **After Deployment:**

1. **Test New Version:**
   - Open: https://voice-agent-ngrok.vercel.app
   - Click "Start Call"
   - Test voice agent
   - Should use ngrok TTS

2. **Test Production:**
   - Open: https://ai-voice-agent-omega.vercel.app
   - Click "Start Call"
   - Should still work (unchanged)

3. **Both Should Work Independently!**

---

## 🆘 **Troubleshooting**

### **Backend Deploy Fails:**
- Check environment variables are set
- Check branch is `ngrok-tts-version`
- Check root directory is `voice agent/backend`

### **Frontend Deploy Fails:**
- Check branch is `ngrok-tts-version`
- Check root directory is `voice agent/frontend`
- Check build command is `npm run build`

### **WebSocket Connection Fails:**
- Check URL uses `wss://` (not `ws://`)
- Check backend URL is correct
- Check CORS is enabled in backend

---

## 📚 **Useful Links**

- **GitHub Repo:** https://github.com/Sonu789163/AiVoiceAgent
- **Branch:** https://github.com/Sonu789163/AiVoiceAgent/tree/ngrok-tts-version
- **Render Dashboard:** https://dashboard.render.com
- **Vercel Dashboard:** https://vercel.com/dashboard

---

## 🎉 **You're Ready!**

Follow the steps above to deploy your new version without affecting production!

**Good luck!** 🚀
