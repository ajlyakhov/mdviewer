# Code Signing Setup

Builds are unsigned by default and will still work — signing is opt-in via GitHub Actions secrets.  
When the secrets below are present, the CI build automatically signs and (for macOS) notarizes the app.

---

## macOS — Sign + Notarize

Signing removes the *"app is damaged"* Gatekeeper warning.  
Notarization means users can open the app without right-clicking → *Open* or running `xattr`.

### What you need
- Enrolled in the **Apple Developer Program** ($99/year — [developer.apple.com](https://developer.apple.com))
- A **Developer ID Application** certificate (for distribution outside the App Store)

### Step-by-step

1. **Export the certificate as a .p12 file**  
   Open *Keychain Access* → find your *Developer ID Application* certificate → right-click → *Export* → save as `.p12` with a strong password.

2. **Base64-encode the certificate**
   ```bash
   base64 -i certificate.p12 | tr -d '\n'
   ```

3. **Create an app-specific password**  
   Go to [appleid.apple.com](https://appleid.apple.com) → *Sign-In and Security* → *App-Specific Passwords* → generate one.

4. **Find your Team ID**  
   Log in at [developer.apple.com](https://developer.apple.com/account) → your Team ID is shown in the top-right (10 characters, e.g. `ABC1234XYZ`).

5. **Add GitHub Actions secrets** (repo → *Settings* → *Secrets and variables* → *Actions*):

   | Secret name                   | Value                                      |
   |-------------------------------|--------------------------------------------|
   | `MAC_CERTS`                   | Base64-encoded `.p12` from step 2          |
   | `MAC_CERTS_PASSWORD`          | Password you set when exporting the `.p12` |
   | `APPLE_ID`                    | Your Apple ID email                        |
   | `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from step 3          |
   | `APPLE_TEAM_ID`               | Your 10-character Team ID                  |

---

## Windows — Sign

Signing removes the *SmartScreen "Unknown publisher"* warning.  
An **EV (Extended Validation)** certificate gives immediate SmartScreen reputation; an OV certificate builds reputation over time.

### What you need
- A code-signing certificate from a trusted CA (DigiCert, Sectigo, GlobalSign, etc.)
  - **OV certificate** — ~$200–400/year, standard USB token or PFX file
  - **EV certificate** — ~$300–500/year, hardware token required; bypasses SmartScreen immediately

### Step-by-step

1. **Export the certificate as a .pfx file** (or obtain it from your CA as .pfx).

2. **Base64-encode the certificate**
   ```bash
   # macOS/Linux
   base64 -i certificate.pfx | tr -d '\n'
   ```

3. **Add GitHub Actions secrets**:

   | Secret name          | Value                                       |
   |----------------------|---------------------------------------------|
   | `WIN_CERTS`          | Base64-encoded `.pfx` from step 2           |
   | `WIN_CERTS_PASSWORD` | Password for the `.pfx` file               |

---

## How it works

- If any required secret is missing, the build proceeds **unsigned** — no errors, just no signing.
- macOS signing uses `hardenedRuntime: true` with the entitlements in `assets/entitlements.mac.plist`.
- macOS notarization runs via the `afterSign` hook in `scripts/notarize.js` using `notarytool`.
- Windows signing is handled automatically by electron-builder when `WIN_CSC_LINK` is set.
