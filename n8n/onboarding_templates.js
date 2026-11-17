// Source of the after-payment WhatsApp templates (submitted to Meta through the Graph API by a one-off n8n workflow).
// {{1}} = the customer's first name. Languages: en, ru, ky_KG. Category UTILITY, except the Demo Day request (MARKETING, with opt-out footer).
const D = {
  welcome: {
    en: "Hi {{1}}! 🎉 Welcome to GetForce Vibe Coding. Your payment has been checked. Our onboarding manager will help you join the Discord community. If you have any questions, just reply to this message 😊",
    ru: "Здравствуйте, {{1}}! 🎉 Добро пожаловать в GetForce Vibe Coding. Ваша оплата проверена. Наш менеджер по адаптации поможет вам войти в сообщество в Discord. Если есть вопросы, просто ответьте на это сообщение 😊",
    ky: "Саламатсызбы, {{1}}! 🎉 GetForce Vibe Coding курсуна кош келиңиз. Төлөмүңүз текшерилди. Адаптация боюнча менеджерибиз сизге Discord коомчулугуна кирүүгө жардам берет. Суроолоруңуз болсо, ушул билдирүүгө жооп жазыңыз 😊",
  },
  prep: {
    en: "Hi {{1}}! 👋 To get a great start, please get ready in advance:\n\n💻 a computer (laptop or desktop; the course cannot be done on a phone)\n🤖 a Claude subscription (about $20 per month)\n\nIf anything is unclear or you need help, just reply here 😊",
    ru: "Здравствуйте, {{1}}! 👋 Чтобы хорошо начать, подготовьте заранее:\n\n💻 компьютер (ноутбук или ПК; с телефона курс пройти нельзя)\n🤖 подписку Claude (около $20 в месяц)\n\nЕсли что-то непонятно или нужна помощь, просто ответьте здесь 😊",
    ky: "Саламатсызбы, {{1}}! 👋 Жакшы баштоо үчүн алдын ала даярдаңыз:\n\n💻 компьютер (ноутбук же ПК; курсту телефондон өтүүгө болбойт)\n🤖 Claude подпискасы (айына болжол менен $20)\n\nБир нерсе түшүнүксүз болсо же жардам керек болсо, ушул жерге жооп жазыңыз 😊",
  },
  reminder: {
    en: "Hi {{1}}! A quick reminder: the cohort starts on November 27 🚀\n\nClasses are held on Mondays, Wednesdays and Fridays at 20:00 Bishkek time, online on Zoom.\n\nPlease make sure your computer and Claude subscription are ready 💻 If you need help, just reply here.",
    ru: "Здравствуйте, {{1}}! Напоминаем: набор стартует 27 ноября 🚀\n\nЗанятия проходят по понедельникам, средам и пятницам в 20:00 по Бишкеку, онлайн в Zoom.\n\nПроверьте, что компьютер и подписка Claude готовы 💻 Если нужна помощь, просто ответьте здесь.",
    ky: "Саламатсызбы, {{1}}! Эскертебиз: набор 27-ноябрда башталат 🚀\n\nСабактар дүйшөмбү, шаршемби жана жума күндөрү Бишкек убактысы менен 20:00до Zoom аркылуу онлайн өтөт.\n\nКомпьютериңиз жана Claude подпискаңыз даяр экенин текшериңиз 💻 Жардам керек болсо, ушул жерге жооп жазыңыз.",
  },
  checkin: {
    en: "Hi {{1}}! How is your first week going? 🙂 What is working well, and where do you need help? Reply with one message and we will help.",
    ru: "Здравствуйте, {{1}}! Как проходит первая неделя? 🙂 Что уже получилось, а где нужна помощь? Ответьте одним сообщением, и мы поможем.",
    ky: "Саламатсызбы, {{1}}! Биринчи апта кандай өтүп жатат? 🙂 Эмне жакшы чыкты, кайсы жерде жардам керек? Бир билдирүү менен жооп жазыңыз, биз жардам беребиз.",
  },
  demo: {
    en: "Hi {{1}}! Congratulations on Demo Day! 🎉 Could you tell us in a couple of sentences what the course gave you and what you built? Text or a voice message is fine. With your permission, we would love to share your story 🙌",
    ru: "Здравствуйте, {{1}}! Поздравляем с Demo Day! 🎉 Расскажете в паре предложений, что вам дал курс и что вы создали? Можно текстом или голосовым. С вашего разрешения мы поделимся вашей историей 🙌",
    ky: "Саламатсызбы, {{1}}! Demo Day менен куттуктайбыз! 🎉 Курс сизге эмне берди жана эмне жасадыңыз, эки-үч сүйлөм менен айтып бересизби? Текст же үн билдирүүсү болсо да болот. Уруксатыңыз менен окуяңызды бөлүшөбүз 🙌",
  },
};
const FOOT = { en: "Reply STOP to opt out", ru: "Напишите СТОП, чтобы отписаться", ky: "Билдирүү алгыңыз келбесе, СТОП деп жазыңыз" };
const CODE = { en: "en", ru: "ru", ky: "ky_KG" };
const EX = { en: "Aigerim", ru: "Айгерим", ky: "Айгерим" };
const out = [];
for (const step of Object.keys(D)) {
  for (const lang of ["en", "ru", "ky"]) {
    const components = [{ type: "BODY", text: D[step][lang], example: { body_text: [[EX[lang]]] } }];
    if (step === "demo") components.push({ type: "FOOTER", text: FOOT[lang] });
    out.push({ json: { name: "onb_" + step + "_" + lang, language: CODE[lang], category: step === "demo" ? "MARKETING" : "UTILITY", components } });
  }
}
return out;
