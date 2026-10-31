const form = [
  'grant_type=password',
  'client_id=' + encodeURIComponent(TOKEN_CLIENT_ID),
  'username=' + encodeURIComponent(USERNAME),
  'password=' + encodeURIComponent(PASSWORD),
  'scope=openid',
].join('&');
const login = http.post(ISSUER + '/protocol/openid-connect/token', {
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: form,
});
if (!login.ok) throw new Error('Token request failed: ' + login.status + ' ' + login.body);
const token = json(login.body).access_token;

const hex = '0123456789abcdef';
let key = '';
for (let i = 0; i < 36; i++) {
  if (i === 8 || i === 13 || i === 18 || i === 23) key += '-';
  else if (i === 14) key += '4';
  else if (i === 19) key += hex[8 + Math.floor(Math.random() * 4)];
  else key += hex[Math.floor(Math.random() * 16)];
}

const request = {
  headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Idempotency-Key': key },
  body: JSON.stringify({ text: TEXT }),
};
const first = http.post(API_URL + '/api/tasks', request);
if (first.status !== 202) throw new Error('Submit failed: ' + first.status + ' ' + first.body);
const again = http.post(API_URL + '/api/tasks', request);
if (again.status !== 202 || json(again.body).taskId !== json(first.body).taskId) {
  throw new Error('The same Idempotency-Key gave another task: ' + again.body);
}
output.offlineTaskId = json(first.body).taskId;
