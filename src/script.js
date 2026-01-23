fetch('https://bill116-20116.wykr.es/webhook-test/formularz-kontaktowy', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    imie: "bot",
    email: "danieldziubek11@gmail.com",
    wiadomosc: "Cześć, to test!"
  })
});