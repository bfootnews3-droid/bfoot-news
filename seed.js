const { db } = require('./db');

if (db.prepare('SELECT COUNT(*) c FROM articles').get().c) { console.log('Des données existent déjà.'); process.exit(0); }

const art = db.prepare(`INSERT INTO articles(slug,category,title_ar,title_fr,excerpt_ar,excerpt_fr,content_ar,content_fr,is_breaking,published)
                        VALUES (?,?,?,?,?,?,?,?,?,1)`);
[
  ['demo-breaking', 'breaking', 'خبر عاجل تجريبي', 'Article urgent de démonstration', 'نص تجريبي للتأكد من عمل الموقع.', 'Texte de démonstration pour vérifier le site.', 'هذا مقال تجريبي. عدّله أو احذفه من لوحة التحكم.\n\nفقرة ثانية.', "Ceci est un article de démonstration. Modifiez-le ou supprimez-le depuis l'administration.\n\nDeuxième paragraphe.", 1],
  ['demo-transfers', 'transfers', 'مقال تجريبي عن الانتقالات', 'Article de démonstration : transferts', '', 'Exemple de contenu pour la catégorie Transferts.', 'محتوى تجريبي.', 'Contenu de démonstration.', 0],
  ['demo-clubs', 'clubs', 'مقال تجريبي عن الأندية', 'Article de démonstration : clubs', '', 'Exemple de contenu pour la catégorie Clubs.', 'محتوى تجريبي.', 'Contenu de démonstration.', 0],
  ['demo-competitions', 'competitions', 'مقال تجريبي عن المسابقات', 'Article de démonstration : compétitions', '', 'Exemple de contenu pour les compétitions.', 'محتوى تجريبي.', 'Contenu de démonstration.', 0],
].forEach((a) => art.run(...a));

const pid = db.prepare('INSERT INTO polls(question_ar,question_fr) VALUES (?,?)').run('من الأفضل في العالم؟', 'Qui est le meilleur joueur du monde ?').lastInsertRowid;
const opt = db.prepare('INSERT INTO poll_options(poll_id,label_ar,label_fr,position) VALUES (?,?,?,?)');
[['اللاعب أ', 'Joueur A'], ['اللاعب ب', 'Joueur B'], ['اللاعب ج', 'Joueur C']].forEach((o, i) => opt.run(pid, o[0], o[1], i));

console.log('Données de démonstration créées.');
