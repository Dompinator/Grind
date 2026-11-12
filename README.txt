GRIND v0.1 — Local HTML prototype

HOW TO RUN
1. Extract the ZIP.
2. Open index.html in a modern browser (Chrome, Edge or Firefox).
3. Sign up with a demo username and password.

WHAT WORKS IN THIS VERSION
- Login/sign-up demo screen
- Local profile and cash balance ($15 starting cash)
- Feed tabs: New, Popular and Safe
- Create one currency per account
- Upload a currency logo/picture
- Open currency detail page
- Demo buy buttons: $1, $5, $10, $50, $100 (green buy action)
- Sell 25% of owned shares
- Portfolio / Money page
- Profile name and picture editing
- Watchlist toggle
- Local browser saving using localStorage

IMPORTANT LIMITATIONS
This is version 0.1: a frontend prototype that saves data only in the current browser on the current device.
It is NOT yet connected to Supabase. Accounts are demo-only; do not use a real password.
Different people/devices do NOT share the same market yet.
The price movement is a simple demo simulation, not a production market engine.
Images are stored in this browser's local storage and limited to 650 KB each.

NEXT VERSION
Connect Supabase Auth, Storage and a secure database transaction engine so all players share the same accounts, currencies, balances and market.
