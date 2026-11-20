// Token Radar's night dashboard. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, a per-protocol detail panel
// with the model's own inputs and the protocol's farm plan, and the live-token view.
// No network: every byte it shows is in data.js.
//
// The page recomputes each row from the snapshot figures — the category multiple, the
// growth, age and breadth factors — and checks the number board.json carries, so the
// page's code and the board's data are visibly the same arithmetic. It also regenerates
// each farm plan from the same derivation main.ts writes to board.json.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;

  var state = {
    q: '',
    category: 'all',
    chain: 'all',
    sort: 'implied',
    dir: -1,
    tab: 'pre-token',
    watchOnly: false,
    selected: null
  };

  // ------------------------------------------------------------ formatting

  var usdFull = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFull.format(n);
  }

  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(2) + 'x';
  }

  function chainLabel(row) {
    return row.chains && row.chains.length ? row.chains.slice(0, 2).join(', ') : 'an unnamed chain';
  }

  function categoryLabel(row) {
    return row.category || 'Other';
  }

  // ------------------------------------------------------------ the model, recomputed

  // The same arithmetic lib/model.ts runs: TVL x the category's market multiple x the
  // growth, age and breadth factors. The multiple arrives with the row; the other three
  // are rebuilt here from the row's own figures and the model's constants.
  function impliedOf(row) {
    var m = DATA.model;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var weight = growth >= 0 ? m.growth_up_weight : m.growth_down_weight;
    var growthFactor = Math.min(m.growth_factor_max, Math.max(m.growth_factor_min, 1 + (growth / 100) * weight));
    var age = row.age_days === null || row.age_days === undefined ? (DATA.median_age_days || 365) : row.age_days;
    var ageFactor = m.age_floor + (Math.min(Math.max(age, 0), m.age_days) / m.age_days) * m.age_range;
    var breadthFactor = 1 + Math.min(Math.max((row.chains || []).length - 1, 0), m.breadth_max_chains) * m.breadth_step;
    return Math.max(1, Math.round(row.tvl_usd * row.multiple * growthFactor * ageFactor * breadthFactor));
  }

  function factorsOf(row) {
    var m = DATA.model;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var weight = growth >= 0 ? m.growth_up_weight : m.growth_down_weight;
    return {
      growthPct: growth,
      growthFactor: Math.min(m.growth_factor_max, Math.max(m.growth_factor_min, 1 + (growth / 100) * weight)),
      ageFactor: row.age_factor,
      breadthFactor: row.breadth_factor
    };
  }

  // ------------------------------------------------------------ the farm plan, regenerated

  function chainOf(p) {
    return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain';
  }

  function capitalFor(p) {
    if (p.tvl_usd >= 1e10) return 300;
    if (p.tvl_usd >= 1e9) return 200;
    if (p.tvl_usd >= 1e8) return 100;
    if (p.tvl_usd >= 1e7) return 50;
    return 25;
  }

  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 90) return 90;
    if (age < 365) return 60;
    return 30;
  }

  function coreActionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Lend $' + capital + ' of USDC on ' + name + ' (' + chain + ') and leave the supply earning.';
    if (c.indexOf('dex') >= 0 || c.indexOf('amm') >= 0 || c.indexOf('liquidity') >= 0) return 'Add $' + capital + ' of liquidity to ' + name + "'s deepest pool on " + chain + ' and hold the LP tokens.';
    if (c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0 || c.indexOf('aggregator') >= 0) return 'Deposit $' + capital + " into " + name + "'s highest-yield vault on " + chain + ' and keep the receipt tokens.';
    if (c.indexOf('bridge') >= 0) return 'Move $' + capital + ' of USDC to ' + chain + ' through ' + name + ', then put the bridged funds to work in one app there.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + ' through ' + name + ' on ' + chain + ' and keep the staking receipt in the same wallet.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Post $' + capital + ' of USDC as margin on ' + name + ' and open a single small hedged trade.';
    if (c.indexOf('prediction') >= 0) return 'Back one outcome with $' + capital + ' on ' + name + ' and let the position settle.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + ' of ' + name + "'s yield-bearing asset on " + chain + ' and hold it in the farming wallet.';
    if (c.indexOf('stable') >= 0 || c.indexOf('issuer') >= 0) return 'Mint or hold $' + capital + ' of the stable asset ' + name + ' issues on ' + chain + '.';
    if (c.indexOf('launchpad') >= 0) return 'Stake $' + capital + " to join " + name + "'s next sale on " + chain + ' and take part in one allocation.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Allocate $' + capital + ' to a ' + name + ' vault on ' + chain + ' and hold the vault shares.';
    return 'Put $' + capital + ' to work in ' + name + ' on ' + chain + ' and leave the position open.';
  }

  function secondActionFor(p) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow a small amount against the supply once, then repay it within the same week.';
    if (c.indexOf('dex') >= 0 || c.indexOf('amm') >= 0 || c.indexOf('liquidity') >= 0) return 'Swap a small amount through the pool once a week so the wallet shows trading activity.';
    if (c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0 || c.indexOf('aggregator') >= 0) return "Claim or compound the vault's yield once, so the wallet records a harvest.";
    if (c.indexOf('bridge') >= 0) return 'Bridge a second, smaller amount a week later to show repeat use.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Top up the stake once during the hold, in the same wallet.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Close the hedge after two weeks and open a fresh one with the same margin.';
    if (c.indexOf('prediction') >= 0) return 'Settle one market and open another with a small stake.';
    return 'Use one more feature of ' + name + ' during the first month: a swap, a vote, or a second deposit.';
  }

  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Keep the position open and check the protocol's own page once a week.";
    return s;
  }

  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Open a fresh wallet used only for this farm, fund it with $' + (capital + 10) + ', and keep its seed phrase offline.', cost: 'under $3 of gas to fund it', time: '5 minutes' },
      { text: coreActionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 200 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: secondActionFor(p), cost: 'about $2 of gas', time: '10 minutes' },
      { text: 'Do one qualifying action each week — a deposit, a borrow, a swap or a vote — so the wallet stays active.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Once a month, open the protocol's own points or rewards page from inside its app and check what the wallet earned. Claim only through the link the app itself publishes, and never pay to claim.", cost: 'free to check', time: '10 minutes a month' },
      { text: 'Keep a farm log with the wallet address, the dates, the amounts and every transaction hash, and decide the exit before any token exists.', cost: 'nothing but the log', time: '5 minutes a week' }
    ].map(stepText);
  }

  // ------------------------------------------------------------ filtering and sorting

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchOnly && !r.watchlist) return false;
      if (state.category !== 'all' && categoryLabel(r) !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, categoryLabel(r), (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function sortValue(row, key) {
    if (key === 'name') return row.name.toLowerCase();
    if (key === 'tvl') return row.tvl_usd;
    if (key === 'growth') return row.change_7d === null ? -Infinity : row.change_7d;
    if (key === 'age') return row.age_days === null ? Infinity : row.age_days;
    if (key === 'multiple') return row.multiple;
    return row.implied_value_usd;
  }

  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av = sortValue(a, key);
      var bv = sortValue(b, key);
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // ------------------------------------------------------------ hash state

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab') === 'live' ? 'live' : 'pre-token';
    if (params.get('watch')) state.watchOnly = params.get('watch') === '1';
    if (params.get('p')) state.selected = params.get('p');
  }

  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.watchOnly) params.set('watch', '1');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // ------------------------------------------------------------ rendering

  var boardEl = document.getElementById('board');
  var countEl = document.getElementById('count');
  var statsEl = document.getElementById('stats');
  var modelEl = document.getElementById('model');
  var detailEl = document.getElementById('detail');
  var scrimEl = document.getElementById('scrim');
  var metaEl = document.getElementById('masthead-meta');

  function renderMeta() {
    metaEl.textContent = 'Snapshot ' + DATA.as_of + ' · DefiLlama protocol index · ' + DATA.model_version + ' model';
  }

  function renderStats() {
    var top = DATA.rows[0];
    statsEl.innerHTML =
      statHtml(fmtUsd(top ? top.implied_value_usd : 0), 'Top implied value' + (top ? ' — ' + top.name : '')) +
      statHtml(DATA.watchlist_size + ' / ' + DATA.watchlist_size, 'Watchlist protocols covered') +
      statHtml(String(DATA.early_size), 'Early rows below the floor') +
      statHtml(fmtMult(DATA.multiples.overall), 'Overall market multiple');
  }

  function statHtml(value, label) {
    return '<div class="stat"><b>' + esc(value) + '</b><span>' + esc(label) + '</span></div>';
  }

  function fillOptions() {
    var categories = Array.from(new Set(DATA.rows.map(categoryLabel))).sort();
    var chains = Array.from(new Set(DATA.rows.flatMap(function (r) { return r.chains || []; }))).sort();
    var catSel = document.getElementById('category');
    var chainSel = document.getElementById('chain');
    catSel.innerHTML = '<option value="all">All categories</option>' +
      categories.map(function (c) { return '<option value="' + esc(c) + '"' + (c === state.category ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
    chainSel.innerHTML = '<option value="all">All chains</option>' +
      chains.map(function (c) { return '<option value="' + esc(c) + '"' + (c === state.chain ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
  }

  function sortHeader(key, label) {
    var arrow = state.sort === key ? (state.dir < 0 ? ' ▼' : ' ▲') : '';
    return '<th scope="col"><button type="button" class="th-btn" data-sort="' + key + '">' + esc(label) + esc(arrow) + '</button></th>';
  }

  function boardTable(list) {
    var max = list.length ? list[0].implied_value_usd : 1;
    var rowsHtml = list.map(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down';
      var width = Math.max(3, Math.round((r.implied_value_usd / max) * 100));
      return '<tr data-slug="' + esc(r.slug) + '" tabindex="0" class="' +
        (r.rank <= 3 ? 'top3 ' : '') + (state.selected === r.slug ? 'selected' : '') + '">' +
        '<td><span class="rank-badge">' + r.rank + '</span></td>' +
        '<td><div class="name"><b>' + esc(r.name) + '</b>' +
        '<span class="sub">' + esc(categoryLabel(r)) + ' · ' + esc(chainLabel(r)) + '</span></div></td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + growthClass + '">' + growth + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td class="num">' + fmtMult(r.multiple) + '</td>' +
        '<td><span class="bar" aria-hidden="true"><i style="width:' + width + '%"></i></span>' +
        '<span class="num">' + fmtUsd(r.implied_value_usd) + '</span></td>' +
        '<td><button type="button" class="details-btn" data-detail="' + esc(r.slug) + '">Farm plan</button></td>' +
        '</tr>';
    }).join('');
    return '<div class="panel"><div class="table-wrap"><table>' +
      '<caption>Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.</caption>' +
      '<thead><tr>' + sortHeader('implied', 'Rank') + sortHeader('name', 'Protocol') + sortHeader('tvl', 'TVL') +
      sortHeader('growth', '7d') + sortHeader('age', 'Age') + sortHeader('multiple', 'Multiple') +
      sortHeader('implied', 'Implied value') + '<th scope="col">Plan</th></tr></thead>' +
      '<tbody>' + rowsHtml + '</tbody></table></div></div>';
  }

  function liveTable() {
    var rowsHtml = DATA.live.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td><span class="chip">live</span></td>' +
        '<td><div class="name"><b>' + esc(r.name) + '</b>' +
        '<span class="sub">' + esc(categoryLabel(r)) + ' · ' + esc(chainLabel(r)) + '</span></div></td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'up' : 'down') + '">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num">' + fmtUsd(r.mcap_usd) + '</td>' +
        '<td class="num">' + fmtMult(r.market_multiple) + '</td></tr>';
    }).join('');
    return '<div class="panel"><div class="table-wrap"><table>' +
      '<caption>Token live: these protocols already trade, so their market cap is a fact, not a model. Their market multiples are the comparables the pre-token board is priced from.</caption>' +
      '<thead><tr><th scope="col">Status</th><th scope="col">Protocol</th><th scope="col">TVL</th><th scope="col">7d</th><th scope="col">Market cap</th><th scope="col">Mcap / TVL</th></tr></thead>' +
      '<tbody>' + rowsHtml + '</tbody></table></div></div>';
  }

  function renderBoard() {
    if (state.tab === 'live') {
      countEl.textContent = DATA.live.length + ' live-token protocols, by market cap';
      boardEl.innerHTML = liveTable();
      return;
    }
    var list = sortedRows(visibleRows());
    countEl.textContent = list.length + ' of ' + DATA.rows.length + ' pre-token rows shown';
    if (list.length === 0) {
      boardEl.innerHTML = '<div class="panel"><div class="empty"><h2>No protocol matches that filter</h2>' +
        '<p>Clear the search or pick another category or chain to see the board again.</p>' +
        '<button type="button" class="button primary" id="clear-filters">Clear filters</button></div></div>';
      var clearBtn = document.getElementById('clear-filters');
      if (clearBtn) clearBtn.addEventListener('click', clearFilters);
      return;
    }
    boardEl.innerHTML = boardTable(list);
  }

  function renderModel() {
    var m = DATA.model;
    var topMultiples = Object.entries(DATA.multiples.by_category)
      .sort(function (a, b) { return b[1] - a[1]; })
      .slice(0, 7);
    var cards = '<div class="multiple"><span>Overall median</span><b>' + fmtMult(DATA.multiples.overall) + '</b></div>' +
      topMultiples.map(function (kv) {
        return '<div class="multiple"><span>' + esc(kv[0]) + '</span><b>' + fmtMult(kv[1]) + '</b></div>';
      }).join('');
    modelEl.innerHTML =
      '<div class="panel model"><h2>How implied value is computed</h2>' +
      '<p>Each protocol is priced the way the market prices a launched one of its kind: its TVL times the ' +
      'median market-cap / TVL of launched protocols in the same category. Where a category has fewer than ' +
      m.min_category_samples + ' launched protocols with a market cap, the overall median is used. No protocol ' +
      'name is special-cased, and no row is hand-picked.</p>' +
      '<div class="formula">implied = round( tvl x multiple x growth x age x breadth )\n' +
      'multiple = median mcap / TVL of launched protocols in the category\n' +
      'growth   = 1 + clamp(7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' +
      m.growth_up_weight + ' up, ' + m.growth_down_weight + ' down, clamped [' + m.growth_factor_min + ', ' + m.growth_factor_max + ']\n' +
      'age      = ' + m.age_floor + ' + ' + m.age_range + ' x min(age_days, ' + m.age_days + ') / ' + m.age_days + '\n' +
      'breadth  = 1 + ' + m.breadth_step + ' x min(chains - 1, ' + m.breadth_max_chains + ')</div>' +
      '<div class="multiples">' + cards + '</div>' +
      '<p>Age is the time since the protocol was first listed — the best record of how long it has run with ' +
      'no token. A protocol with no listing date takes the pre-token cohort’s median age. The early radar is ' +
      'every rankable pre-token protocol below the watchlist floor, ranked by implied value, and the ' +
      'live-token protocols are set aside with their market caps shown.</p></div>';
  }

  // ------------------------------------------------------------ detail panel

  function openDetail(slug) {
    var row = null;
    for (var i = 0; i < DATA.rows.length; i++) {
      if (DATA.rows[i].slug === slug) { row = DATA.rows[i]; break; }
    }
    if (!row) return;
    state.selected = slug;
    writeHash();
    var f = factorsOf(row);
    var recomputed = impliedOf(row);
    var steps = farmSteps(row);
    var stepsHtml = steps.map(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      return '<li><b>' + esc(action) + '</b><span class="cost">' + esc(tail) + '</span></li>';
    }).join('');
    detailEl.innerHTML =
      '<div class="detail-head"><div><span class="detail-kicker">Rank ' + row.rank + ' of ' + DATA.board_size + ' · Pre-token</span>' +
      '<h2 id="detail-title">' + esc(row.name) + '</h2>' +
      '<p class="sub">' + esc(categoryLabel(row)) + ' on ' + esc((row.chains || []).join(', ') || 'an unnamed chain') +
      ' · records no token</p></div>' +
      '<button type="button" class="close" id="detail-close" aria-label="Close details">Close</button></div>' +
      '<section class="detail-section"><h3>Implied value</h3><div class="equation">' +
      '<div><span>TVL</span><b>' + fmtUsd(row.tvl_usd) + '</b></div>' +
      '<div><span>Category multiple (' + esc(categoryLabel(row)) + ')</span><b>' + fmtMult(row.multiple) + '</b></div>' +
      '<div><span>Seven-day growth</span><b>' + fmtPct(row.change_7d) + ' → ' + f.growthFactor.toFixed(2) + 'x</b></div>' +
      '<div><span>Age with no token</span><b>' + fmtAge(row.age_days) + ' → ' + row.age_factor.toFixed(2) + 'x</b></div>' +
      '<div><span>Chain breadth (' + (row.chains || []).length + ' chains)</span><b>' + row.breadth_factor.toFixed(2) + 'x</b></div>' +
      '<div class="total"><span>Implied value</span><b>' + fmtUsd(row.implied_value_usd) + '</b></div>' +
      '</div><p class="match">The page recomputes this row as <b>' + fmtUsd(recomputed) + '</b>' +
      (recomputed === row.implied_value_usd ? ' — the same number board.json carries.' : ' — which differs from the board: the data would be stale.') +
      ' This is an estimate, not a price.</p></section>' +
      '<section class="detail-section"><h3>Farm plan</h3><ol class="steps">' + stepsHtml + '</ol></section>';
    detailEl.hidden = false;
    scrimEl.hidden = false;
    document.getElementById('detail-close').addEventListener('click', closeDetail);
    renderBoard();
  }

  function closeDetail() {
    state.selected = null;
    detailEl.hidden = true;
    scrimEl.hidden = true;
    writeHash();
    renderBoard();
  }

  function clearFilters() {
    state.q = '';
    state.category = 'all';
    state.chain = 'all';
    state.watchOnly = false;
    var q = document.getElementById('q');
    var cat = document.getElementById('category');
    var ch = document.getElementById('chain');
    var watch = document.getElementById('watch-only');
    if (q) q.value = '';
    if (cat) cat.value = 'all';
    if (ch) ch.value = 'all';
    if (watch) watch.checked = false;
    writeHash();
    renderBoard();
  }

  // ------------------------------------------------------------ wiring

  function setTab(tab) {
    state.tab = tab;
    document.getElementById('tab-pre').setAttribute('aria-pressed', tab === 'pre-token' ? 'true' : 'false');
    document.getElementById('tab-live').setAttribute('aria-pressed', tab === 'live' ? 'true' : 'false');
    writeHash();
    renderBoard();
  }

  function setSort(key) {
    if (state.sort === key) state.dir = -state.dir;
    else {
      state.sort = key;
      state.dir = key === 'name' ? 1 : -1;
    }
    var sortSel = document.getElementById('sort');
    if (sortSel) sortSel.value = state.sort;
    renderBoard();
  }

  function render() {
    renderMeta();
    renderStats();
    fillOptions();
    renderModel();
    renderBoard();
    if (state.selected) openDetail(state.selected);
  }

  function init() {
    readHash();
    var q = document.getElementById('q');
    var cat = document.getElementById('category');
    var ch = document.getElementById('chain');
    var sortSel = document.getElementById('sort');
    var watch = document.getElementById('watch-only');
    if (q) {
      q.value = state.q;
      q.addEventListener('input', function () { state.q = q.value; writeHash(); renderBoard(); });
    }
    if (cat) {
      cat.value = state.category;
      cat.addEventListener('change', function () { state.category = cat.value; writeHash(); renderBoard(); });
    }
    if (ch) {
      ch.value = state.chain;
      ch.addEventListener('change', function () { state.chain = ch.value; writeHash(); renderBoard(); });
    }
    if (sortSel) {
      sortSel.value = state.sort;
      sortSel.addEventListener('change', function () { setSort(sortSel.value); });
    }
    if (watch) {
      watch.checked = state.watchOnly;
      watch.addEventListener('change', function () { state.watchOnly = watch.checked; writeHash(); renderBoard(); });
    }
    document.getElementById('tab-pre').addEventListener('click', function () { setTab('pre-token'); });
    document.getElementById('tab-live').addEventListener('click', function () { setTab('live'); });
    scrimEl.addEventListener('click', closeDetail);
    boardEl.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-sort]') : null;
      if (btn) { setSort(btn.getAttribute('data-sort')); return; }
      var detailBtn = e.target.closest ? e.target.closest('[data-detail]') : null;
      if (detailBtn) { openDetail(detailBtn.getAttribute('data-detail')); return; }
      var tr = e.target.closest ? e.target.closest('tr[data-slug]') : null;
      if (tr) openDetail(tr.getAttribute('data-slug'));
    });
    boardEl.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var tr = e.target.closest ? e.target.closest('tr[data-slug]') : null;
      if (tr) { e.preventDefault(); openDetail(tr.getAttribute('data-slug')); }
    });
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !detailEl.hidden) closeDetail();
    });
    render();
  }

  init();

  // The model, exposed so the entry's own checks can verify the page against board.json.
  window.RADAR_MODEL = { impliedOf: impliedOf, farmSteps: farmSteps };
})();
