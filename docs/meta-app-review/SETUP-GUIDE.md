# Meta (Facebook + Instagram) App Review Guide

This document walks you through:
1. Creating a Meta app
2. Configuring it for development (works for your account only — for testing)
3. Submitting for App Review (required for other users to connect)
4. Privacy Policy + Terms of Service templates (review requires these)
5. Screencast script (review requires a demo video)

---

## Step 1: Create a Meta App (~5 minutes)

1. Go to https://developers.facebook.com
2. Log in with your Facebook account
3. Click **"My Apps"** → **"Create App"**
4. Fill in:
   - **App Name**: `NetAmplify`
   - **App Contact Email**: your email
   - **App Purpose**: "Manage integrations for myself or my business" (fastest approval)
5. Click "Create App"

You'll be redirected to your app dashboard. Note the **App ID** (a 15-digit number at the top) and **App Secret** (click "Show" to reveal).

---

## Step 2: Add Required Products (~3 minutes)

On your app dashboard:

1. Scroll down to **"Add Products"**
2. Find **"Facebook Login"** → click **"Set Up"**
3. Find **"Instagram Graph API"** → click **"Set Up"** (under "Instagram" section)
4. Find **"Facebook Login for Business"** → may already be added; if not, add it

---

## Step 3: Configure Facebook Login (~5 minutes)

1. Left sidebar → **Facebook Login** → **Settings**
2. Under **"Valid OAuth Redirect URIs"**, add BOTH:
   ```
   http://localhost:3000/api/oauth/facebook/callback
   http://localhost:3000/api/oauth/instagram/callback
   ```
3. (For production, add your real domain):
   ```
   https://your-domain.com/api/oauth/facebook/callback
   https://your-domain.com/api/oauth/instagram/callback
   ```
4. Save changes

---

## Step 4: Set Environment Variables (~1 minute)

Add to your NetAmplify `.env`:

```bash
FACEBOOK_APP_ID=<your-app-id>
FACEBOOK_APP_SECRET=<your-app-secret>
```

Restart your backend. The "Facebook" and "Instagram" cards on the Connect page should now show "Connect via OAuth" instead of "Setup pending".

---

## Step 5: Test in Development Mode (~5 minutes)

In Development mode, your app works ONLY for accounts added as testers:
1. App dashboard → **App Roles** → **Roles** → **Add People**
2. Add your own Facebook account as **Tester** (you should already be Admin)
3. Add friends/colleagues who will test the app as Testers too

Now go to NetAmplify → Connections → Facebook → Click "Connect via OAuth"
- You'll see Facebook's permission dialog
- Click "Continue as <your name>" → "Allow"
- Return to NetAmplify with "Connected" status

**Development mode limitation**: Only Testers can authenticate. Other users get an error. To allow any user, you must go through App Review (next step).

---

## Step 6: Prepare for App Review (REQUIRED for public use)

For any user outside your Testers list to connect their Facebook/Instagram, your app must be in **Live mode**, which requires App Review.

### App Review checklist

Meta requires these items for review:

1. **Privacy Policy URL** — Public URL (not localhost). Use a free GitHub Pages site or a real domain.
2. **Terms of Service URL** — Same as above.
3. **Data Deletion Callback URL** — An endpoint on your backend that receives data deletion requests (we'll add this to NetAmplify).
4. **App Screencast** — 2-5 minute video showing how your app uses each permission.
5. **Permission Justifications** — For each permission (scope), explain how it's used.

### Required permissions for review

| Permission | Why Meta requires justification | Your justification |
|------------|-------------------------------|---------------------|
| `pages_show_list` | To show list of user's FB Pages so they can pick which one to post to | "NetAmplify allows users to post to their Facebook Page. We display a list of the user's Pages so they can choose which Page to post to." |
| `pages_read_engagement` | Meta policy requires this even for write-only apps | "Per Meta Platform Policy, we read Page metadata to ensure the user is an admin of the Page they're posting to." |
| `pages_manage_posts` | To create the post on the user's behalf | "We use this to publish text posts to the user's Facebook Page when they click Publish in NetAmplify." |
| `instagram_basic` | To read IG account info | "We read the user's Instagram Business account ID to know where to publish posts." |
| `instagram_content_publish` | To publish content to Instagram | "We use this to publish posts with image + caption to the user's Instagram Business account." |

### Screencast script (record this video)

**Duration**: 2-5 minutes (screen recording with voiceover)

**Format**: MP4, upload to YouTube (unlisted) or Meta's upload tool.

**Script**:
> Hi, I'm submitting my app NetAmplify for App Review.
>
> NetAmplify is a multi-platform publishing tool. Users connect their social media accounts once, then post to all of them with one click.
>
> [Show website URL in browser]
>
> Let me walk through how the Facebook integration works:
>
> **[Demo Facebook login]**
> 1. I'm logged out. I click "Connect Facebook".
> 2. Facebook's official OAuth dialog appears — the user logs in here, on Facebook's domain. NetAmplify never sees their password.
> 3. The user sees the requested permissions:
>    - pages_show_list — to display their Pages
>    - pages_manage_posts — to publish to the Page they select
> 4. They click "Continue" → "Allow".
>
> **[Show connected state in NetAmplify]**
> 5. Back in NetAmplify, Facebook shows as "Connected".
>
> **[Demo publishing]**
> 6. The user writes a post in NetAmplify's editor.
> 7. They select "Publish to Facebook" and click "Publish".
> 8. NetAmplify sends the post to the user's Facebook Page via the Graph API.
>
> **[Show the post on Facebook]**
> 9. The post appears on the user's Facebook Page, attributed to the user.
>
> We don't store Facebook data — only the access token (encrypted). Users can disconnect at any time, which deletes the token. They can also revoke access from their Facebook settings at any time.
>
> Thank you for reviewing NetAmplify.

### Privacy Policy template (REQUIRED for review)

Save this as `privacy.html` and host on a public URL (GitHub Pages works):

```html
<!DOCTYPE html>
<html>
<head><title>NetAmplify Privacy Policy</title></head>
<body>
<h1>NetAmplify Privacy Policy</h1>
<p>Last updated: 2026-10-05</p>

<h2>1. What We Collect</h2>
<p>NetAmplify collects the following data when you connect a platform:</p>
<ul>
  <li><strong>OAuth access tokens</strong> for platforms you connect (Facebook, Instagram, X, LinkedIn, etc.). These tokens are stored encrypted (AES-256-GCM).</li>
  <li><strong>Account identifiers</strong> (your username on each platform).</li>
  <li><strong>Post content</strong> you create and publish via NetAmplify.</li>
</ul>

<h2>2. How We Use Your Data</h2>
<p>We use your OAuth tokens only to publish posts you create in NetAmplify to the platforms you've connected. We do not:</p>
<ul>
  <li>Read your private messages or DMs.</li>
  <li>Post on your behalf without your explicit action.</li>
  <li>Sell your data to third parties.</li>
  <li>Share your data with advertisers.</li>
</ul>

<h2>3. Facebook-Specific Data</h2>
<p>When you connect Facebook, we access:</p>
<ul>
  <li>Your Facebook user ID (to identify you).</li>
  <li>The list of Facebook Pages you administer (to let you choose which Page to post to).</li>
  <li>Page access tokens (to publish posts to the selected Page).</li>
</ul>
<p>We do NOT access your personal timeline, friends list, or private posts.</p>

<h2>4. Instagram-Specific Data</h2>
<p>When you connect Instagram, we access:</p>
<ul>
  <li>Your Instagram Business account ID.</li>
  <li>Your Instagram username (for display).</li>
  <li>The ability to publish posts with image + caption.</li>
</ul>

<h2>5. Data Retention</h2>
<p>We retain your encrypted OAuth tokens until you disconnect a platform or delete your NetAmplify account. When you disconnect, we immediately delete the token from our database.</p>

<h2>6. Your Rights</h2>
<p>You can:</p>
<ul>
  <li>Disconnect any platform at any time (deletes the token).</li>
  <li>Delete your NetAmplify account (deletes all your data).</li>
  <li>Revoke platform access from each platform's settings (Facebook Settings → Apps & Websites).</li>
</ul>

<h2>7. Data Deletion Request</h2>
<p>To request deletion of your data, email: <a href="mailto:your-email@example.com">your-email@example.com</a>. We respond within 30 days.</p>

<h2>8. Contact</h2>
<p>Email: <a href="mailto:your-email@example.com">your-email@example.com</a></p>
</body>
</html>
```

### Terms of Service template (REQUIRED for review)

```html
<!DOCTYPE html>
<html>
<head><title>NetAmplify Terms of Service</title></head>
<body>
<h1>NetAmplify Terms of Service</h1>
<p>Last updated: 2026-10-05</p>

<h2>1. Acceptance of Terms</h2>
<p>By using NetAmplify, you agree to these Terms of Service. If you do not agree, do not use the service.</p>

<h2>2. Service Description</h2>
<p>NetAmplify is a multi-platform publishing tool that allows users to publish posts to multiple social media platforms from a single interface.</p>

<h2>3. User Responsibilities</h2>
<p>You agree to:</p>
<ul>
  <li>Only publish content you have the right to publish.</li>
  <li>Not use the service for spam, harassment, or illegal content.</li>
  <li>Comply with each platform's Terms of Service (Facebook, Instagram, X, LinkedIn, etc.).</li>
  <li>Not abuse the service or attempt to overload it.</li>
</ul>

<h2>4. Account Security</h2>
<p>You are responsible for maintaining the security of your NetAmplify account. Notify us immediately of any unauthorized use.</p>

<h2>5. Limitation of Liability</h2>
<p>NetAmplify is provided "as is" without warranties. We are not liable for damages arising from use of the service, including platform-side restrictions (e.g., Facebook rate limits, account suspensions).</p>

<h2>6. Termination</h2>
<p>We may terminate your account for violations of these Terms. You may delete your account at any time.</p>

<h2>7. Changes to Terms</h2>
<p>We may update these Terms. Continued use after changes constitutes acceptance.</p>

<h2>8. Contact</h2>
<p>Email: <a href="mailto:your-email@example.com">your-email@example.com</a></p>
</body>
</html>
```

---

## Step 7: Submit for App Review

1. App dashboard → **App Review** → **Permissions and Features**
2. For each advanced permission (pages_manage_posts, instagram_content_publish), click **"Request Advanced Access"**
3. Fill in:
   - **Justification** (use the table above)
   - **Screencast URL** (your YouTube unlisted video)
   - **Privacy Policy URL**
   - **Terms of Service URL**
4. Submit for review

**Review timeline**: 2-4 weeks. Meta may ask for revisions — address them promptly.

**Common rejection reasons**:
- Privacy Policy missing or insufficient
- Screencast doesn't show actual login + publish flow
- Permission justification too vague
- App is in Development mode at time of review (must be in Live mode after approval)

---

## Quick Reference: URLs to Set Up

| What | Where to Add It |
|------|-----------------|
| `FACEBOOK_APP_ID` + `FACEBOOK_APP_SECRET` env vars | NetAmplify `.env` |
| `http://localhost:3000/api/oauth/facebook/callback` | Facebook Login → Valid OAuth Redirect URIs |
| `http://localhost:3000/api/oauth/instagram/callback` | Facebook Login → Valid OAuth Redirect URIs |
| `https://your-domain.com/privacy.html` | App Settings → Privacy Policy URL |
| `https://your-domain.com/terms.html` | App Settings → Terms of Service URL |
| Screencast video (YouTube unlisted) | App Review → Screencast URL |

---

## Production Checklist

- [ ] Meta app created
- [ ] Facebook Login product added
- [ ] Instagram Graph API product added
- [ ] OAuth redirect URIs configured (localhost + production)
- [ ] `FACEBOOK_APP_ID` + `FACEBOOK_APP_SECRET` in `.env`
- [ ] App in Development mode (works for your account only — for testing)
- [ ] Tested Facebook OAuth flow works
- [ ] Tested Instagram OAuth flow works
- [ ] Privacy Policy hosted on public URL
- [ ] Terms of Service hosted on public URL
- [ ] Screencast video recorded (2-5 min)
- [ ] App Review submitted for Live mode
- [ ] (After approval) App switched to Live mode

After approval, ANY user can connect Facebook + Instagram — no developer-side configuration needed.
