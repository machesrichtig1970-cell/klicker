// ============================================================
// 🎮 TERMUX CLICKER GAME – OHNE NATIVE MODULE (JSON-Datenbank)
// ============================================================

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = 3000;
const DB_FILE = path.join(__dirname, 'db.json');

// ------------------------------------------------------------
// 📁 JSON-DATENBANK (einfach, schnell, kein Kompilieren)
// ------------------------------------------------------------
function loadDB() {
    if (!fs.existsSync(DB_FILE)) {
        // Initiale Datenbankstruktur
        const initialData = {
            users: [],
            upgrades: [
                { id: 1, name: 'Kupfer-Maus', price: 50, income_boost: 2 },
                { id: 2, name: 'Auto-Clicker V1', price: 200, income_boost: 5 },
                { id: 3, name: 'Goldene Tastatur', price: 10000, income_boost: 250 }
            ],
            stocks: [
                { id: 1, symbol: 'BTC', name: 'Bitcoin', price: 50000.00 },
                { id: 2, symbol: 'ETH', name: 'Ethereum', price: 2500.00 },
                { id: 3, symbol: 'SOL', name: 'Solana', price: 120.00 },
                { id: 4, symbol: 'LTC', name: 'Litecoin', price: 80.00 },
                { id: 5, symbol: 'ADA', name: 'Cardano', price: 0.50 }
            ],
            userStocks: [],
            nextId: { user: 1, stock: 6, upgrade: 4, userStock: 1 }
        };
        fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
        return initialData;
    }
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ------------------------------------------------------------
// 🔧 HILFSFUNKTIONEN
// ------------------------------------------------------------
function findUserById(users, id) {
    return users.find(u => u.id === id);
}

function findUserByUsername(users, username) {
    return users.find(u => u.username === username);
}

// ------------------------------------------------------------
// 🚀 EXPRESS SETUP
// ------------------------------------------------------------
app.use(express.json());
app.use(cookieParser());

// ------------------------------------------------------------
// 🔐 AUTH-MIDDLEWARE (Cookie-basiert)
// ------------------------------------------------------------
async function authenticateUser(req, res, next) {
    const userId = parseInt(req.cookies.userId);
    if (!userId) return res.status(401).send('Bitte anmelden.');

    const db = loadDB();
    const user = findUserById(db.users, userId);
    if (!user) {
        res.clearCookie('userId', { path: '/' });
        return res.status(401).send('Benutzer nicht gefunden.');
    }
    req.userId = userId;
    req.db = db; // für nachfolgende Handler
    next();
}

// ------------------------------------------------------------
// 🔑 AUTH-ROUTEN
// ------------------------------------------------------------
app.post('/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).send('Felder fehlen.');

        const db = loadDB();
        if (findUserByUsername(db.users, username)) {
            return res.status(409).send('Name bereits vergeben.');
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const newUser = {
            id: db.nextId.user++,
            username,
            password_hash: passwordHash,
            balance: 100.00,
            income_per_click: 1.00,
            auto_income_per_second: 0.00,
            created_at: new Date().toISOString()
        };
        db.users.push(newUser);
        saveDB(db);

        res.status(201).send('Erfolgreich registriert.');
    } catch (error) {
        console.error(error);
        res.status(500).send('Fehler bei Registrierung.');
    }
});

app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).send('Daten fehlen.');

        const db = loadDB();
        const user = findUserByUsername(db.users, username);
        if (user) {
            const isValid = await bcrypt.compare(password, user.password_hash);
            if (isValid) {
                res.cookie('userId', user.id.toString(), {
                    httpOnly: true,
                    maxAge: 86400000,
                    path: '/'
                });
                return res.status(200).send('Login erfolgreich.');
            }
        }
        res.status(401).send('Daten inkorrekt.');
    } catch (error) {
        console.error(error);
        res.status(500).send('Serverfehler beim Login.');
    }
});

app.post('/logout', (req, res) => {
    res.clearCookie('userId', { path: '/' });
    res.status(200).send('Logout erfolgreich.');
});

// ------------------------------------------------------------
// 🎮 SPIEL-API (geschützt)
// ------------------------------------------------------------
app.use('/api', authenticateUser);

// Spielstand abrufen
app.get('/api/state', (req, res) => {
    const user = findUserById(req.db.users, req.userId);
    res.json({
        balance: user.balance,
        incomePerClick: user.income_per_click,
        autoIncomePerSecond: user.auto_income_per_second
    });
});

// Klick verarbeiten
app.post('/api/click', (req, res) => {
    const db = req.db;
    const user = findUserById(db.users, req.userId);
    user.balance += user.income_per_click;
    saveDB(db);
    res.status(200).send('Klick verarbeitet.');
});

// Alle Upgrades abrufen
app.get('/api/upgrades', (req, res) => {
    res.json(req.db.upgrades);
});

// Upgrade kaufen
app.post('/api/buy-upgrade', (req, res) => {
    const db = req.db;
    const { upgradeId } = req.body;
    const upgrade = db.upgrades.find(u => u.id == upgradeId);
    if (!upgrade) return res.status(404).send('Upgrade nicht gefunden.');

    const user = findUserById(db.users, req.userId);
    if (user.balance < upgrade.price) {
        return res.status(400).send('Zu wenig Geld.');
    }

    user.balance -= upgrade.price;
    user.income_per_click += upgrade.income_boost;
    user.auto_income_per_second += upgrade.income_boost / 2;

    saveDB(db);
    res.status(200).send('Upgrade gekauft.');
});

// Kontostand speichern (vom Frontend regelmäßig)
app.post('/api/save-balance', (req, res) => {
    const { balance } = req.body;
    if (typeof balance !== 'number') return res.status(400).send('Ungültig.');

    const db = req.db;
    const user = findUserById(db.users, req.userId);
    user.balance = balance;
    saveDB(db);
    res.status(200).send('Gespeichert.');
});

// Aktienkurse abrufen
app.get('/api/stocks', (req, res) => {
    res.json(req.db.stocks);
});

// Aktie kaufen
app.post('/api/buy-stock', (req, res) => {
    const db = req.db;
    const { stockId, price } = req.body;

    const user = findUserById(db.users, req.userId);
    if (user.balance < parseFloat(price)) {
        return res.status(400).send('Zu wenig Geld.');
    }

    user.balance -= parseFloat(price);

    // In userStocks eintragen / Menge erhöhen
    const existing = db.userStocks.find(
        s => s.user_id === req.userId && s.stock_id == stockId
    );
    if (existing) {
        existing.quantity += 1;
    } else {
        db.userStocks.push({
            id: db.nextId.userStock++,
            user_id: req.userId,
            stock_id: parseInt(stockId),
            quantity: 1,
            buy_price: parseFloat(price)
        });
    }

    saveDB(db);
    res.status(200).send('Aktie gekauft.');
});

// Benutzer-Investments abrufen
app.get('/api/investments', (req, res) => {
    const db = req.db;
    const investments = db.userStocks
        .filter(s => s.user_id === req.userId)
        .map(s => {
            const stock = db.stocks.find(st => st.id === s.stock_id);
            return {
                ...s,
                symbol: stock.symbol,
                name: stock.name,
                current_price: stock.price
            };
        });
    res.json(investments);
});

// ------------------------------------------------------------
// 📈 WEBSOCKET – AKTIENKURS-SIMULATION
// ------------------------------------------------------------
wss.on('connection', (ws) => {
    console.log('📡 WebSocket verbunden');
    const db = loadDB();
    ws.send(JSON.stringify({ type: 'initial-prices', data: db.stocks }));
});

// Alle 5 Sekunden Kurse zufällig verändern
setInterval(() => {
    const db = loadDB();
    db.stocks.forEach(stock => {
        const fluctuation = (Math.random() - 0.5) * 0.5;
        let newPrice = stock.price + fluctuation;
        if (newPrice < 0.01) newPrice = 0.01;
        stock.price = parseFloat(newPrice.toFixed(2));
    });
    saveDB(db);

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'price-update', data: db.stocks }));
        }
    });
}, 5000);

// ------------------------------------------------------------
// 🏠 FRONTEND (eingebettet – HTML + JS)
// ------------------------------------------------------------
const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Clicker Game mit Aktien</title>
    <style>
        /* gleiches CSS wie vorher – der Kürze halber hier nicht wiederholt,
           aber du kannst es aus der vorherigen Version übernehmen */
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: linear-gradient(135deg, #1a1a2e, #16213e); color: #fff; min-height: 100vh; display: flex; justify-content: center; align-items: center; padding: 20px; }
        .container { max-width: 900px; width: 100%; background: rgba(255,255,255,0.1); backdrop-filter: blur(10px); border-radius: 20px; padding: 30px; box-shadow: 0 15px 35px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.2); }
        h1, h2 { color: #4cc9f0; text-align: center; margin-bottom: 20px; }
        #auth-container, #game-container { transition: all 0.3s; }
        input, button { width: 100%; padding: 12px; margin: 8px 0; border-radius: 8px; border: none; font-size: 16px; }
        input { background: rgba(255,255,255,0.2); color: #fff; }
        input::placeholder { color: #ccc; }
        button { background: linear-gradient(135deg, #4cc9f0, #4361ee); color: white; font-weight: bold; cursor: pointer; transition: 0.3s; }
        button:hover { transform: translateY(-2px); box-shadow: 0 10px 20px rgba(76,201,240,0.3); }
        button:disabled { opacity: 0.5; transform: none; box-shadow: none; cursor: not-allowed; }
        #click-area { width: 100%; padding: 40px; background: rgba(76,201,240,0.1); border: 3px solid #4cc9f0; border-radius: 20px; margin: 20px 0; cursor: pointer; transition: 0.1s; user-select: none; text-align: center; }
        #click-area:active { transform: scale(0.98); background: rgba(76,201,240,0.2); }
        #income-per-click { font-size: 1.2em; color: #f72585; margin-top: 10px; }
        .balance-display { font-size: 28px; font-weight: bold; color: #f72585; text-align: center; margin-bottom: 10px; }
        .navbar { display: flex; justify-content: space-around; background: rgba(0,0,0,0.3); padding: 10px; border-radius: 50px; margin-top: 30px; }
        .nav-item { color: white; text-decoration: none; display: flex; flex-direction: column; align-items: center; font-size: 14px; }
        .nav-item.active { color: #4cc9f0; }
        .icon { font-size: 24px; }
        .badge, .new-label { background: #f72585; color: white; border-radius: 50%; padding: 2px 6px; font-size: 12px; margin-left: 5px; }
        .stock-card { background: rgba(0,0,0,0.3); padding: 15px; margin: 10px 0; border-radius: 10px; border-left: 4px solid #4cc9f0; }
        .stock-price { font-size: 20px; font-weight: bold; }
        .positive { color: #4ade80; }
        .negative { color: #f87171; }
        #logout-btn { width: auto; padding: 8px 16px; margin: 0; background: rgba(247,37,133,0.8); }
        #upgrade-list { list-style: none; margin-top: 20px; }
        .upgrade-item { display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.3); padding: 15px; margin: 5px 0; border-radius: 8px; }
    </style>
</head>
<body>
    <div class="container">
        <!-- AUTH CONTAINER -->
        <div id="auth-container">
            <h1>💰 Clicker Game</h1>
            <form id="login-form">
                <input type="text" id="login-username" placeholder="Benutzername" required>
                <input type="password" id="login-password" placeholder="Passwort" required>
                <button type="submit">Anmelden</button>
            </form>
            <p style="text-align: center; margin-top: 15px;">Noch kein Konto? <a href="#" id="show-register" style="color: #4cc9f0;">Registrieren</a></p>
            <form id="register-form" style="display: none;">
                <input type="text" id="register-username" placeholder="Benutzername" required>
                <input type="password" id="register-password" placeholder="Passwort" required>
                <button type="submit">Registrieren</button>
            </form>
            <p style="text-align: center;"><a href="#" id="show-login" style="display: none; color: #4cc9f0;">Zurück zum Login</a></p>
            <p style="text-align: center; color: #aaa; margin-top: 20px;">Testaccount: testspieler / test123</p>
        </div>

        <!-- GAME CONTAINER (versteckt) -->
        <div id="game-container" style="display: none;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h2>Spieler</h2>
                <button id="logout-btn">Abmelden</button>
            </div>
            <div class="balance-display">
                Kontostand: <span id="balance-amount">0.00 €</span>
            </div>
            <div id="click-area">
                <div style="font-size: 60px;">💰</div>
                <div id="income-per-click">0.00 € pro Klick</div>
                Klicken für Einkommen
            </div>

            <h2>Upgrades</h2>
            <ul id="upgrade-list"></ul>

            <h2 style="margin-top: 30px;">📈 Aktienmarkt</h2>
            <div id="stocks-container"></div>

            <footer>
                <nav class="navbar">
                    <a href="#" class="nav-item">
                        <span class="icon">✉️</span>
                        <span class="badge" id="badge-portfolio">4</span>
                    </a>
                    <a href="#" class="nav-item">
                        <span class="icon">📉</span>
                        <span class="badge" id="badge-analytics">1</span>
                    </a>
                    <a href="#" class="nav-item active">
                        <span class="icon">🏡</span>
                    </a>
                    <a href="#" class="nav-item">
                        <span class="icon">⚒️</span>
                        <span class="new-label">NEW</span>
                    </a>
                    <a href="#" class="nav-item">
                        <span class="icon">👤</span>
                    </a>
                </nav>
            </footer>
        </div>
    </div>

    <script>
        // ---------- FRONTEND LOGIK ----------
        const ws = new WebSocket(\`ws://\${window.location.host}\`);
        let currentBalance = 0;
        let currentAutoIncomePerSecond = 0;

        // DOM-Elemente
        const authContainer = document.getElementById('auth-container');
        const gameContainer = document.getElementById('game-container');
        const loginForm = document.getElementById('login-form');
        const registerForm = document.getElementById('register-form');
        const showRegisterLink = document.getElementById('show-register');
        const showLoginLink = document.getElementById('show-login');
        const logoutBtn = document.getElementById('logout-btn');
        const balanceAmountEl = document.getElementById('balance-amount');
        const incomePerClickEl = document.getElementById('income-per-click');
        const clickAreaEl = document.getElementById('click-area');
        const upgradeListEl = document.getElementById('upgrade-list');
        const stocksContainer = document.getElementById('stocks-container');

        // Hilfsfunktionen
        function formatCurrency(amount) {
            return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount);
        }

        // Ansichten wechseln
        function switchToGameView() {
            authContainer.style.display = 'none';
            gameContainer.style.display = 'block';
            fetchGameState();
            fetchUpgrades();
            fetchStocks();
        }

        function switchToAuthView() {
            authContainer.style.display = 'block';
            gameContainer.style.display = 'none';
        }

        // Spielstand laden
        async function fetchGameState() {
            try {
                const res = await fetch('/api/state');
                if (!res.ok) throw new Error('Nicht authentifiziert');
                const data = await res.json();
                currentBalance = parseFloat(data.balance);
                currentAutoIncomePerSecond = parseFloat(data.autoIncomePerSecond || 0);
                balanceAmountEl.textContent = formatCurrency(currentBalance);
                incomePerClickEl.textContent = formatCurrency(data.incomePerClick) + ' pro Klick';
            } catch (e) {
                console.error(e);
                switchToAuthView();
            }
        }

        async function fetchUpgrades() {
            try {
                const res = await fetch('/api/upgrades');
                const upgrades = await res.json();
                upgradeListEl.innerHTML = '';
                upgrades.forEach(upgrade => {
                    const li = document.createElement('li');
                    li.classList.add('upgrade-item');
                    li.innerHTML = \`
                        <span>\${upgrade.name} (+\${formatCurrency(upgrade.income_boost)}/Klick)</span>
                        <button class="buy-btn" data-id="\${upgrade.id}" data-price="\${upgrade.price}">
                            Kaufen (\${formatCurrency(upgrade.price)})
                        </button>\`;
                    upgradeListEl.appendChild(li);
                });
                document.querySelectorAll('.buy-btn').forEach(btn => {
                    btn.addEventListener('click', buyUpgrade);
                    btn.disabled = (currentBalance < parseFloat(btn.dataset.price));
                });
            } catch (e) { console.error(e); }
        }

        async function buyUpgrade(e) {
            const upgradeId = e.target.dataset.id;
            try {
                const res = await fetch('/api/buy-upgrade', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ upgradeId })
                });
                if (res.ok) {
                    fetchGameState();
                    fetchUpgrades();
                } else {
                    alert(await res.text());
                }
            } catch (e) { console.error(e); }
        }

        async function sendClick() {
            try {
                await fetch('/api/click', { method: 'POST' });
                fetchGameState();
            } catch (e) { console.error(e); }
        }

        // Aktien laden
        async function fetchStocks() {
            try {
                const res = await fetch('/api/stocks');
                const stocks = await res.json();
                renderStocks(stocks);
            } catch (e) { console.error(e); }
        }

        function renderStocks(stocks) {
            stocksContainer.innerHTML = '';
            stocks.forEach(stock => {
                const card = document.createElement('div');
                card.className = 'stock-card';
                card.dataset.symbol = stock.symbol;
                card.innerHTML = \`
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <strong>\${stock.symbol}</strong> - \${stock.name || ''}
                        </div>
                        <div>
                            <span class="stock-price">\${formatCurrency(stock.price)}</span>
                            <span class="stock-change positive">+0.00€ (0.00%)</span>
                        </div>
                    </div>
                    <button class="buy-stock-btn" data-id="\${stock.id}" data-price="\${stock.price}">
                        Kaufen (\${formatCurrency(stock.price)})
                    </button>
                \`;
                stocksContainer.appendChild(card);
            });

            document.querySelectorAll('.buy-stock-btn').forEach(btn => {
                btn.addEventListener('click', buyStock);
                btn.disabled = (currentBalance < parseFloat(btn.dataset.price));
            });
        }

        async function buyStock(e) {
            const stockId = e.target.dataset.id;
            const price = e.target.dataset.price;
            if (currentBalance < parseFloat(price)) {
                alert('Zu wenig Guthaben!');
                return;
            }
            try {
                const res = await fetch('/api/buy-stock', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ stockId, price })
                });
                if (res.ok) {
                    alert('Aktie gekauft!');
                    fetchGameState();
                } else {
                    alert(await res.text());
                }
            } catch (e) { console.error(e); }
        }

        // WebSocket Aktualisierung
        ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.type === 'initial-prices' || message.type === 'price-update') {
                updateStockPrices(message.data);
            }
        };

        function updateStockPrices(stocks) {
            stocks.forEach(newStock => {
                const card = document.querySelector(\`.stock-card[data-symbol="\${newStock.symbol}"]\`);
                if (!card) return;
                const priceEl = card.querySelector('.stock-price');
                const changeSpan = card.querySelector('.stock-change');
                const oldPrice = parseFloat(priceEl.textContent.replace(/[^\\d.-]/g, '')) || 0;
                const newPrice = parseFloat(newStock.price);
                const change = newPrice - oldPrice;
                const percentChange = oldPrice !== 0 ? (change / oldPrice) * 100 : 0;

                priceEl.textContent = formatCurrency(newPrice);
                priceEl.style.color = newPrice >= oldPrice ? '#4ade80' : '#f87171';
                if (changeSpan) {
                    changeSpan.textContent = \`\${change >= 0 ? '+' : ''}\${change.toFixed(2)}€ (\${percentChange.toFixed(2)}%)\`;
                    changeSpan.className = 'stock-change ' + (change >= 0 ? 'positive' : 'negative');
                }

                // Kauf-Button Preis aktualisieren
                const buyBtn = card.querySelector('.buy-stock-btn');
                if (buyBtn) {
                    buyBtn.dataset.price = newPrice;
                    buyBtn.innerHTML = \`Kaufen (\${formatCurrency(newPrice)})\`;
                    buyBtn.disabled = (currentBalance < newPrice);
                }
            });
        }

        // Passives Einkommen jede Sekunde
        setInterval(async () => {
            if (gameContainer.style.display === 'block' && currentAutoIncomePerSecond > 0) {
                currentBalance += currentAutoIncomePerSecond;
                balanceAmountEl.textContent = formatCurrency(currentBalance);
                // Speichern alle 10 Sekunden
                if (Math.floor(Date.now() / 1000) % 10 === 0) {
                    await fetch('/api/save-balance', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ balance: currentBalance })
                    });
                }
            }
        }, 1000);

        // Event-Listener
        clickAreaEl.addEventListener('click', sendClick);

        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('login-username').value;
            const password = document.getElementById('login-password').value;
            const res = await fetch('/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            if (res.ok) {
                switchToGameView();
            } else {
                alert('Login fehlgeschlagen: ' + await res.text());
            }
        });

        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('register-username').value;
            const password = document.getElementById('register-password').value;
            const res = await fetch('/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            if (res.ok) {
                alert('Registrierung erfolgreich! Bitte einloggen.');
                showLoginLink.click();
            } else {
                alert('Fehler: ' + await res.text());
            }
        });

        logoutBtn.addEventListener('click', async () => {
            await fetch('/logout', { method: 'POST' });
            switchToAuthView();
        });

        showRegisterLink.addEventListener('click', (e) => {
            e.preventDefault();
            loginForm.style.display = 'none';
            registerForm.style.display = 'block';
            showLoginLink.style.display = 'block';
            showRegisterLink.style.display = 'none';
        });

        showLoginLink.addEventListener('click', (e) => {
            e.preventDefault();
            loginForm.style.display = 'block';
            registerForm.style.display = 'none';
            showLoginLink.style.display = 'none';
            showRegisterLink.style.display = 'block';
        });

        // Start: Prüfen ob eingeloggt
        fetchGameState().then(() => switchToGameView()).catch(() => switchToAuthView());
    </script>
</body>
</html>`;

// ------------------------------------------------------------
// 🏠 ROUTEN FÜR FRONTEND
// ------------------------------------------------------------
app.get('/', (req, res) => {
    res.send(HTML_TEMPLATE);
});

// ------------------------------------------------------------
// 🚀 SERVER STARTEN
// ------------------------------------------------------------
server.listen(PORT, '0.0.0.0', () => {
    const ip = getLocalIP();
    console.log(`✅ Server gestartet unter:`);
    console.log(`   • Lokal:   http://localhost:${PORT}`);
    console.log(`   • Netzwerk: http://${ip}:${PORT}`);
    console.log(`🎮 Testaccount: testspieler / test123`);
    console.log(`🛑 Stoppen mit Strg+C`);
});

function getLocalIP() {
    const interfaces = require('os').networkInterfaces();
    for (let iface of Object.values(interfaces)) {
        for (let alias of iface) {
            if (alias.family === 'IPv4' && !alias.internal) {
                return alias.address;
            }
        }
    }
    return '0.0.0.0';
}
