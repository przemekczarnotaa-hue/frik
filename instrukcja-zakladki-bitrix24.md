# Instrukcja: Publikowanie zakładek (tabów) w Bitrix24 CRM

Instrukcja dla agenta AI — jak tworzyć i publikować lokalne aplikacje Bitrix24 z zakładkami CRM.

---

## 1. Czym jest lokalna aplikacja Bitrix24

Lokalna aplikacja to zestaw plików HTML/JS hostowanych na zewnętrznym serwerze, które Bitrix24 ładuje w iframe'ach. Aplikacja składa się z:

- **install.html** — strona instalacyjna (rejestruje placementy)
- **Pliki zakładek** — strony HTML wyświetlane w zakładkach CRM

Bitrix24 wymaga, żeby pliki były dostępne przez HTTPS z publicznego URL-a.

---

## 2. Gdzie hostować pliki

Opcje hostingu:
- **Własny serwer** (VPS/dedykowany) — pliki serwowane przez nginx/apache
- **GitHub Pages** — darmowy hosting dla statycznych stron (HTTPS z automatu)
- **Cloudflare Pages** — j.w., z dodatkowym CDN

Kluczowe wymaganie: pliki muszą być dostępne z przeglądarki użytkownika (nie z serwera Bitrix24) — bo ładują się w iframe.

---

## 3. Rejestracja aplikacji w Bitrix24

1. W panelu Bitrix24 wejdź do: **Aplikacje → Deweloper → Inna (aplikacja lokalna)**
2. Ustaw:
   - **Adres obsługi** (handler URL) — URL głównej strony aplikacji
   - **Adres instalacji** — URL pliku `install.html`
   - **Uprawnienia** — zaznacz potrzebne uprawnienia (CRM, użytkownicy itp.)
3. Zapisz — Bitrix24 nada aplikacji `APP_ID`

Po zapisaniu aplikacja pojawi się na liście zainstalowanych i automatycznie uruchomi stronę instalacyjną (`install.html`).

---

## 4. Struktura install.html

Plik `install.html` rejestruje **placementy** (zakładki/elementy menu) za pomocą Bitrix24 JS SDK.

### Minimalna wersja

```html
<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <title>Instalacja aplikacji</title>
  <script src="//api.bitrix24.com/api/v1/"></script>
</head>
<body>
<h1>Instalacja...</h1>
<div id="status"></div>

<script>
BX24.init(function() {
  var placements = [
    {
      placement: 'CRM_SMART_INVOICE_DETAIL_TAB',
      handler:   'https://twoj-serwer.pl/zakladka',
      title:     'Moja Zakładka'
    }
  ];

  var done = 0;
  placements.forEach(function(p) {
    BX24.callMethod('placement.bind', p, function(result) {
      done++;
      if (result.error()) {
        document.getElementById('status').innerHTML += '<p>Błąd: ' + result.error() + '</p>';
      }
      if (done === placements.length) {
        BX24.installFinish();  // WYMAGANE — kończy proces instalacji
      }
    });
  });
});
</script>
</body>
</html>
```

### Zaawansowana wersja ze smart-diff

Lepsze podejście — sprawdza co już jest zainstalowane i dodaje/aktualizuje/usuwa tylko to, co trzeba:

```html
<script>
BX24.init(function() {

  var BASE = 'https://twoj-serwer.pl/app';

  // Konfiguracja docelowych placementów
  var placements = [
    {placement: 'CRM_SMART_INVOICE_DETAIL_TAB', handler: BASE + '/zakladka1', title: 'Zakładka 1'},
    {placement: 'CRM_CONTACT_DETAIL_TAB',       handler: BASE + '/zakladka2', title: 'Zakładka 2'},
    {placement: 'LEFT_MENU',                     handler: BASE + '/panel',     title: 'Panel'}
  ];

  // Pobierz istniejące placementy
  BX24.callMethod('placement.get', {}, function(result) {
    if (result.error()) {
      BX24.installFinish();
      return;
    }

    var existing = result.data();
    var existingMap = {};
    existing.forEach(function(item) {
      existingMap[item.placement + '|' + item.handler] = item.title;
    });

    var configMap = {};
    placements.forEach(function(c) {
      configMap[c.placement + '|' + c.handler] = true;
    });

    // Diff: co dodać, zaktualizować, usunąć
    var toAdd = [], toUpdate = [], toRemove = [];

    placements.forEach(function(config) {
      var key = config.placement + '|' + config.handler;
      if (!(key in existingMap))                    toAdd.push(config);
      else if (existingMap[key] !== config.title)   toUpdate.push(config);
      // else: bez zmian — pomiń
    });

    existing.forEach(function(item) {
      if (!(item.placement + '|' + item.handler in configMap)) {
        toRemove.push(item);
      }
    });

    var total = toAdd.length + toUpdate.length + toRemove.length;
    if (total === 0) {
      BX24.installFinish();
      return;
    }

    var completed = 0;
    function check() {
      completed++;
      if (completed === total) BX24.installFinish();
    }

    // Dodaj nowe
    toAdd.forEach(function(p) {
      BX24.callMethod('placement.bind', p, function() { check(); });
    });

    // Zaktualizuj (unbind + bind — bo placement.bind nie ma update)
    toUpdate.forEach(function(p) {
      BX24.callMethod('placement.unbind', {placement: p.placement, handler: p.handler}, function() {
        BX24.callMethod('placement.bind', p, function() { check(); });
      });
    });

    // Usuń osierocone
    toRemove.forEach(function(item) {
      BX24.callMethod('placement.unbind', {placement: item.placement, handler: item.handler}, function() { check(); });
    });
  });
});
</script>
```

### Kluczowe zasady install.html

- **Zawsze ładuj SDK:** `<script src="//api.bitrix24.com/api/v1/"></script>`
- **Zawsze wywołaj `BX24.installFinish()`** na końcu — bez tego Bitrix24 nie uzna instalacji za zakończoną
- **Cały kod musi być w callback `BX24.init()`** — SDK musi się zainicjalizować zanim zaczniesz wywoływać API
- **placement.bind nie ma update** — żeby zmienić tytuł, trzeba `placement.unbind` + `placement.bind`

---

## 5. Dostępne typy placementów

| Placement | Gdzie się wyświetla |
|---|---|
| `CRM_DEAL_DETAIL_TAB` | Zakładka w szczegółach transakcji (deal) |
| `CRM_CONTACT_DETAIL_TAB` | Zakładka w szczegółach kontaktu |
| `CRM_COMPANY_DETAIL_TAB` | Zakładka w szczegółach firmy |
| `CRM_LEAD_DETAIL_TAB` | Zakładka w szczegółach leada |
| `CRM_SMART_INVOICE_DETAIL_TAB` | Zakładka w Smart Invoice (fakturze inteligentnej) |
| `CRM_DYNAMIC_XXX_DETAIL_TAB` | Zakładka w Smart Process (XXX = entityTypeId) |
| `LEFT_MENU` | Pozycja w lewym menu nawigacyjnym |
| `CRM_ANALYTICS_MENU` | Menu analityki CRM |

Pełna lista: https://apidocs.bitrix24.com/api-reference/widgets/placements.html

---

## 6. Odkrywanie pól (Field Discovery)

### 6.1 Typy encji (Smart Processes)

Żeby znaleźć entityTypeId danego Smart Process:

```
crm.type.list
```

Zwraca listę obiektów z polami:
- `entityTypeId` — identyfikator liczbowy (np. 31, 26, 1078)
- `title` — nazwa wyświetlana

Standardowe entityTypeId:
- **1** = Lead
- **2** = Deal
- **3** = Contact
- **4** = Company
- **31** = Smart Invoice (Faktura inteligentna)
- Inne numery — Smart Process'y utworzone przez użytkownika

### 6.2 Pola encji

Żeby pobrać listę pól danej encji:

```
crm.item.fields?entityTypeId=31
```

Zwraca obiekt z polami, np.:
```json
{
  "UF_CRM_699C5CF0624E0": {
    "type": "string",
    "isRequired": false,
    "isReadOnly": false,
    "title": "Czy na fakturę",
    "listLabel": "Czy na fakturę",
    "filterLabel": "Czy na fakturę",
    "formLabel": "Czy na fakturę"
  },
  "UF_CRM_6873EF39C2726": {
    "type": "enumeration",
    "isRequired": false,
    "items": [
      {"ID": "1234", "VALUE": "Opcja A"},
      {"ID": "1236", "VALUE": "Opcja B"}
    ]
  }
}
```

### 6.3 Pola typu enumeration (lista wyboru)

Pola typu `enumeration` mają tablicę `items` z dostępnymi wartościami. Każdy item ma:
- `ID` — identyfikator liczbowy (string), używany przy zapisie
- `VALUE` — etykieta wyświetlana

Przy zapisie używasz `ID`, nie `VALUE`:
```javascript
fields: { 'ufCrm_6873EF39C2726': '1234' }  // ustawia na "Opcja A"
```

### 6.4 Pola standardowe vs. UF (user fields)

- **Standardowe pola** mają stałe nazwy: `title`, `stageId`, `assignedById`, `categoryId`, `parentId2`, `createdTime` itd.
- **Pola użytkownika (UF)** mają nazwy zaczynające się od `UF_CRM_` — np. `UF_CRM_6763D5B5BAF91`
- UF pola tworzy się w ustawieniach CRM lub przez API `crm.item.userfield.add`

---

## 7. KRYTYCZNY GOTCHA: Format nazw pól UF_CRM_ vs ufCrm_

To najważniejsza pułapka w Bitrix24 REST API. Są **dwa formaty** nazw pól użytkownika:

| Format | Przykład | Kiedy używać |
|---|---|---|
| `UF_CRM_*` | `UF_CRM_6763D5B5BAF91` | W `select` przy `crm.item.list` |
| `ufCrm_*` | `ufCrm_6763D5B5BAF91` | W `fields` przy `crm.item.update`, `crm.item.add`, i w odpowiedziach z `crm.item.get` |

### Reguła konwersji

```
UF_CRM_xxxxx  →  ufCrm_xxxxx
```

Zamień prefix `UF_CRM_` (7 znaków) na `ufCrm_`, resztę zostaw bez zmian (wielkość liter się zachowuje).

### Funkcja konwertująca

```javascript
// UF_CRM_* → ufCrm_* (do crm.item.update / crm.item.add)
function ufW(ufKey) {
  if (!ufKey.startsWith('UF_CRM_')) return ufKey;
  return 'ufCrm_' + ufKey.slice(7);
}

// ufCrm_* → UF_CRM_* (do select w crm.item.list)
function ufSel(camelKey) {
  return camelKey.replace(/^ufCrm_/, 'UF_CRM_');
}
```

### Przykład użycia

```javascript
// Pobieranie — select używa UF_CRM_
var result = await callMethod('crm.item.list', {
  entityTypeId: 31,
  select: ['id', 'title', 'UF_CRM_6763D5B5BAF91'],
  filter: { '>id': 0 }
});

// Odczyt — odpowiedź ma ufCrm_
var item = result.items[0];
var kwota = item.ufCrm_6763D5B5BAF91;  // ← tak jest w odpowiedzi

// Zapis — fields używa ufCrm_
await callMethod('crm.item.update', {
  entityTypeId: 31,
  id: 123,
  fields: {
    ufCrm_6763D5B5BAF91: 5000  // ← ufCrm_ format
  }
});
```

**Jeśli użyjesz złego formatu — pole się po cichu NIE zapisze, bez błędu.**

---

## 8. REST API — Podstawowe operacje

### 8.1 Wywoływanie API z poziomu zakładki (BX24 JS SDK)

W zakładce załadowanej przez Bitrix24 iframe, SDK jest dostępne automatycznie:

```html
<script src="//api.bitrix24.com/api/v1/"></script>
<script>
BX24.init(function() {
  BX24.callMethod('crm.item.list', {
    entityTypeId: 31,
    select: ['id', 'title', 'stageId'],
    filter: { 'stageId': 'DT31_10:NEW' }
  }, function(result) {
    if (result.error()) { console.error(result.error()); return; }
    var items = result.data().items;
    console.log(items);
  });
});
</script>
```

### 8.2 Wywoływanie API przez webhook

Webhook to URL z tokenem, który pozwala wywoływać API bez SDK:

```
https://twoja-domena.bitrix24.pl/rest/{USER_ID}/{TOKEN}/crm.item.list.json
```

Webhook tworzy się w: **Aplikacje → Webhooki → Przychodzące**

```javascript
const WEBHOOK = 'https://twoja-domena.bitrix24.pl/rest/1/abc123token/';

async function b24(method, params = {}) {
  const url  = WEBHOOK + method + '.json';
  const form = new FormData();
  
  // FormData flattener — wymagany, bo Bitrix24 nie akceptuje JSON body
  function flatten(obj, prefix) {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? prefix + '[' + k + ']' : k;
      if (Array.isArray(v)) {
        v.forEach((item, i) => {
          const aKey = key + '[' + i + ']';
          if (item !== null && typeof item === 'object') flatten(item, aKey);
          else form.append(aKey, item == null ? '' : item);
        });
      } else if (v !== null && typeof v === 'object') {
        flatten(v, key);
      } else {
        form.append(key, v === null || v === undefined ? '' : v);
      }
    }
  }
  
  flatten(params, '');
  const r = await fetch(url, { method: 'POST', body: form });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const json = await r.json();
  if (json.error) throw new Error(json.error_description || json.error);
  return json.result;
}
```

**Ważne:** Bitrix24 REST API akceptuje dane jako `FormData` lub `application/x-www-form-urlencoded`. NIE akceptuje `application/json` body!

### 8.3 crm.item.list — Pobieranie listy elementów

```javascript
var result = await b24('crm.item.list', {
  entityTypeId: 31,
  select: ['id', 'title', 'stageId', 'assignedById', 'UF_CRM_xxxxx'],
  filter: {
    '>=createdTime': '2025-01-01T00:00:00',
    'stageId': 'DT31_10:SUCCESS'
  },
  order: { id: 'DESC' },
  start: 0   // paginacja — co 50 elementów
});

// result.items — tablica elementów
// result.total — łączna liczba pasujących
```

Paginacja: domyślnie 50 elementów. Następna strona: `start: 50`, potem `start: 100` itd.

### 8.4 crm.item.get — Pobranie jednego elementu

```javascript
var item = await b24('crm.item.get', {
  entityTypeId: 31,
  id: 123
});
// item.ufCrm_xxxxx — pola UF w formacie camelCase
```

### 8.5 crm.item.update — Aktualizacja

```javascript
await b24('crm.item.update', {
  entityTypeId: 31,
  id: 123,
  fields: {
    title: 'Nowy tytuł',
    ufCrm_6763D5B5BAF91: 5000,   // pole UF — format ufCrm_
    stageId: 'DT31_10:SUCCESS'
  }
});
```

### 8.6 crm.item.add — Tworzenie nowego elementu

```javascript
var newItem = await b24('crm.item.add', {
  entityTypeId: 31,
  fields: {
    title: 'Nowy element',
    categoryId: 0,
    assignedById: 1,
    parentId2: 456,              // powiązanie z Deal ID 456
    ufCrm_xxxxx: 'wartość'
  }
});
// newItem.item.id — ID nowo utworzonego elementu
```

### 8.7 parentId2 — Powiązanie z transakcją (Deal)

Pole `parentId2` łączy element Smart Process / Smart Invoice z transakcją:
```javascript
fields: { parentId2: dealId }
```

---

## 9. Upload plików

Bitrix24 wymaga specjalnego formatu do upload'u plików. **Musi być FormData** (nie JSON).

### Format pola plikowego

```javascript
// fileData to tablica: [nazwaPliku, base64zawartość]
fields: {
  ufCrm_xxxxx: ['faktura.pdf', base64String]
}
```

### Pełny przykład z FileReader

```javascript
function uploadFile(file, entityTypeId, itemId, ufFieldName) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function() {
      var base64 = reader.result.split(',')[1]; // usuń prefix "data:...;base64,"
      
      var form = new FormData();
      form.append('entityTypeId', entityTypeId);
      form.append('id', itemId);
      form.append('fields[' + ufFieldName + '][0]', file.name);
      form.append('fields[' + ufFieldName + '][1]', base64);
      
      fetch(WEBHOOK + 'crm.item.update.json', {
        method: 'POST',
        body: form
      })
      .then(function(r) { return r.json(); })
      .then(resolve)
      .catch(reject);
    };
    reader.readAsDataURL(file);
  });
}
```

**Ważne:** Przy upload'ach `fileData[0]` to nazwa pliku, `fileData[1]` to zawartość base64 (bez prefixu `data:...`).

---

## 10. Etapy (Stages)

Każda encja CRM ma etapy (stageId). Format ID etapu:

```
DT{entityTypeId}_{categoryId}:{STAGE_CODE}
```

Np. `DT31_10:NEW` = Smart Invoice (31), kategoria 10, etap NEW.

### Pobranie etapów

```javascript
var stages = await b24('crm.status.list', {
  filter: { ENTITY_ID: 'DYNAMIC_31_STAGE_10' }  // 31=entityTypeId, 10=categoryId
});
```

Albo dla standardowych encji:
```
DEAL_STAGE — etapy transakcji
STATUS — etapy leadów
```

---

## 11. Wiersze produktowe (Product Rows)

Smart Invoice i Deale mogą mieć wiersze produktowe:

### Pobranie

```javascript
var rows = await b24('crm.item.productrow.list', {
  filter: { ownerType: 'Tb2', ownerId: 123 }  // Tb2 = Smart Invoice
});
```

### Ustawienie

```javascript
var form = new FormData();
form.append('ownerType', 'Tb2');
form.append('ownerId', '123');
form.append('productRows[0][productName]', 'Produkt 1');
form.append('productRows[0][price]', '100.00');
form.append('productRows[0][quantity]', '2');
form.append('productRows[0][taxRate]', '23');

await fetch(WEBHOOK + 'crm.item.productrow.set', {
  method: 'POST',
  body: form
});
```

ownerType wartości:
- `L` = Lead
- `D` = Deal
- `Tb2` = Smart Invoice
- Inne Smart Process'y — sprawdź dokumentację

---

## 12. Kontekst zakładki (Placement Info)

Gdy zakładka jest ładowana w iframe, możesz pobrać informacje o kontekście:

```javascript
BX24.init(function() {
  var info = BX24.placement.info();
  // info.placement — typ placementu (np. 'CRM_SMART_INVOICE_DETAIL_TAB')
  // info.options.ID — ID elementu, w którym otwarto zakładkę
  
  var entityId = info.options.ID;
  // Teraz możesz pobrać dane tego elementu przez crm.item.get
});
```

---

## 13. Debug — Narzędzie do podglądu pól

Przydatny plik debugowy do badania struktury pól:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Debug Fields</title>
  <script src="//api.bitrix24.com/api/v1/"></script>
</head>
<body>
<h1>Pola encji</h1>
<label>entityTypeId: <input id="eid" type="number" value="31"></label>
<button onclick="load()">Załaduj</button>
<pre id="out" style="white-space:pre-wrap;font-size:12px;"></pre>

<script>
function load() {
  var eid = document.getElementById('eid').value;
  BX24.callMethod('crm.item.fields', {entityTypeId: parseInt(eid)}, function(r) {
    if (r.error()) {
      document.getElementById('out').textContent = 'Błąd: ' + r.error();
      return;
    }
    var fields = r.data().fields;
    // Pokaż tylko pola UF
    var uf = {};
    for (var k in fields) {
      if (k.startsWith('UF_CRM_')) uf[k] = fields[k];
    }
    document.getElementById('out').textContent = JSON.stringify(uf, null, 2);
  });
}

BX24.init(function() { load(); });
</script>
</body>
</html>
```

---

## 14. Wymagania dotyczące konfiguracji pól UF

Żeby pola użytkownika (UF) działały poprawnie w zakładkach i formularzach:

1. **Pole musi istnieć** — utwórz je w ustawieniach CRM lub przez API `crm.item.userfield.add`
2. **Pole musi mieć ustawione etykiety** — `editFormLabel`, `listLabel`, `filterLabel` — inaczej może nie być widoczne w formularzach
3. **Pole musi mieć właściwy typ** — string, double, enumeration, file, datetime itp.
4. **Pole typu enumeration** musi mieć zdefiniowane wartości (items) — bez nich nie działa
5. **Pole musi mieć ustawione `isRequired: false`** jeśli nie chcesz blokować zapisu przy pustym polu — domyślnie nowe pola nie są wymagane, ale sprawdź
6. **Widoczność/dostępność** — pole musi być przypisane do właściwej encji i kategorii

### Tworzenie pola przez API

```javascript
await b24('crm.item.userfield.add', {
  entityTypeId: 31,
  userfield: {
    fieldName: 'UF_CRM_MOJE_POLE',
    userTypeId: 'string',      // string, double, enumeration, file, datetime, boolean
    editFormLabel: { pl: 'Moje pole' },
    listLabel: { pl: 'Moje pole' },
    filterLabel: { pl: 'Moje pole' },
    isRequired: false,
    multiple: false,
    showFilter: 'E',           // E=exact, S=substring, N=none
    settings: {}
  }
});
```

Dla pola enum:
```javascript
userfield: {
  fieldName: 'UF_CRM_STATUS',
  userTypeId: 'enumeration',
  editFormLabel: { pl: 'Status' },
  listLabel: { pl: 'Status' },
  settings: {
    LIST: [
      { VALUE: 'Nowy', SORT: 100 },
      { VALUE: 'W trakcie', SORT: 200 },
      { VALUE: 'Zakończony', SORT: 300 }
    ]
  }
}
```

---

## 15. Limity API

- **Max 50 elementów** na stronę w `crm.item.list` — używaj paginacji (`start` parameter)
- **Rate limit**: ~2 req/s na użytkownika. Przy masowych operacjach stosuj opóźnienia
- **Batch**: `BX24.callBatch()` pozwala wysłać do 50 zapytań w jednym request'cie

### Przykład batch

```javascript
BX24.callBatch([
  ['crm.item.get', {entityTypeId: 31, id: 100}],
  ['crm.item.get', {entityTypeId: 31, id: 101}],
  ['crm.item.get', {entityTypeId: 31, id: 102}]
], function(results) {
  // results[0], results[1], results[2] — odpowiedzi
});
```

---

## 16. Podsumowanie workflow

1. **Poznaj encje** → `crm.type.list` → znajdź entityTypeId
2. **Poznaj pola** → `crm.item.fields?entityTypeId=X` → spisz UF pola i ich typy
3. **Stwórz pliki zakładek** → HTML + JS z logiką biznesową
4. **Stwórz install.html** → rejestracja placementów przez `placement.bind`
5. **Umieść pliki na serwerze** → HTTPS, publiczny URL
6. **Zarejestruj aplikację** → w panelu Bitrix24 jako aplikacja lokalna
7. **Zainstaluj** → Bitrix24 uruchomi install.html, zakładki się pokażą
8. **Testuj** → otwórz element CRM, powinna się pojawić zakładka w iframe
