# COMO COLOCAR NA NUVEM (FIREBASE) — PASSO A PASSO

O sistema hoje guarda tudo no navegador do aparelho (`localStorage`). Isso quer dizer:
computador, tablet e celular têm **bases separadas**. Com o Firebase (Firestore) os três
passam a ver e gravar a **mesma base**.

Você precisa fazer a parte do console (contas e chaves). O código já está pronto nesta pasta.

---

## Parte 1 — criar o projeto no Firebase (5 minutos)

1. Abra <https://console.firebase.google.com> e entre com a sua conta Google.
2. **Criar projeto** (ou "Adicionar projeto").
   - Nome: `ponto-cas` (ou outro).
   - O Google Analytics pode ficar **desativado**.
3. Espere criar e clique em **Continuar**.

## Parte 2 — criar o banco Firestore

1. No menu da esquerda: **Criar** → **Firestore Database** (ou "Bancos de dados e armazenamento").
2. **Criar banco de dados**.
3. Local (location): escolha **southamerica-east1 (São Paulo)**.
4. Modo: **Modo de produção** (depois colamos as regras).
5. **Criar**.

## Parte 3 — colar as regras de segurança

1. Dentro do Firestore, aba **Regras**.
2. Apague tudo e cole o conteúdo do arquivo **`firestore.rules`** desta pasta:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
    match /ponto-cas/{docId} {
      allow read, write: if true;
    }
  }
}
```

3. **Publicar**.

> **Importante:** com `allow read, write: if true`, quem tiver o endereço do seu sistema
> consegue ler e gravar os dados. Para ponto de obra isso é aceitável (o site não é
> divulgado), mas o certo depois é colocar login — veja "Parte 7".

## Parte 4 — pegar as chaves do app da Web

1. Engrenagem ⚙ (topo da esquerda) → **Configurações do projeto**.
2. Aba **Geral**, desça até **Seus apps**.
3. Clique no ícone **`</>`** (Web).
4. Apelido do app: `ponto` → **Registrar app**.
5. Vai aparecer um bloco `const firebaseConfig = { ... }`. **Copie só os valores.**

## Parte 5 — colar as chaves no arquivo `firebase-config.js`

Abra **`firebase-config.js`** e troque o exemplo pelas suas chaves:

```js
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSy...",                       // ← seu
  authDomain: "ponto-cas.firebaseapp.com",   // ← seu
  projectId: "ponto-cas",                    // ← seu
  storageBucket: "ponto-cas.firebasestorage.app",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef123456"
};
```

Salve. Pronto: ao abrir o sistema, no topo aparece **"salvo na nuvem"** em vez de só "salvo".

## Parte 6 — publicar o site (GitHub Pages)

1. Suba os arquivos na pasta do repositório `batedor-de-ponto-2.0` (branch `main`).
2. No GitHub: **Settings → Pages → Source: Deploy from a branch → `main` / root → Save**.
3. Em 1–2 minutos o site fica em `https://kisemonsk-lgtm.github.io/batedor-de-ponto-2.0/`.
4. Abra no computador, no tablet e no celular. **"Adicionar à tela de início"** no tablet/celular
   para virar aplicativo.

> O Firebase exige que o site esteja em `https://` (ou `localhost`) — GitHub Pages serve.
> Abrir o `index.html` direto do arquivo (`file://`) **não** conecta na nuvem.

---

## Como funciona no dia a dia (o que foi feito para não perder lançamento)

- Cada lançamento de ponto (entrada, saída, falta, folga, extra…) leva um **carimbo de hora**.
- Quando dois aparelhos têm dados diferentes, o app **junta** as duas versões:
  - **Pessoas/dias diferentes**: fica tudo — quem lançou no tablet e quem lançou no
    computador aparecem juntos em todos os aparelhos.
  - **Mesma pessoa, mesmo dia**: vale o lançamento **mais recente** (a correção manda).
  - **Funcionário excluído**: não volta mais, mesmo que outro aparelho ainda tivesse ele.
- Depois de juntar, o resultado é enviado de volta para a nuvem, então todos convergem.
- No topo da tela, ao lado de "salvo", o selo **☁️ nuvem** mostra quantos aparelhos já
  gravaram (passe o mouse para ver quais e quando). Se estiver **☁️ desligada**, as chaves
  do Firebase ainda não foram coladas.

## Como funciona no dia a dia

- **Ao abrir**: o app baixa a versão da nuvem. Se a da nuvem for mais nova, pergunta:
  `OK` = usa a da nuvem · `Cancelar` = mantém a deste aparelho e manda para a nuvem.
- **Ao salvar**: grava no aparelho **e** na nuvem (uns 2 segundos depois da última alteração).
- **Outro aparelho aberto**: recebe as mudanças na hora (aparece "Dados atualizados de outro aparelho").
- **Sem internet**: continua funcionando no aparelho e envia quando a conexão voltar.
- **Primeira vez**: o aparelho que você abrir primeiro envia a base dele para a nuvem.
  Se já existir base boa na nuvem, ela é a que vale (a não ser que você clique em `Cancelar`).

## Cuidados

- **Dois aparelhos lançando o MESMO dia ao mesmo tempo**: vale a última gravação da base inteira.
  Combine quem lança o quê (ex.: tablet lança o ponto, computador só imprime).
- O **login** (e-mail/senha) ainda não existe. Se quiser, é a Parte 7.

## Parte 7 — (opcional, depois) exigir login

1. Console → **Authentication** → **Começar** → ativar **E-mail/senha**.
2. Criar os usuários (um por encarregado).
3. Trocar as regras por:

```
match /ponto-cas/{docId} {
  allow read, write: if request.auth != null;
}
```

4. No `nuvem.js`, antes de iniciar, fazer o `firebase.auth().signInWithEmailAndPassword(...)`
   com uma tela de login simples. Me peça que eu monto essa tela quando for a hora.

## Se der erro

| Mensagem no topo | O que fazer |
|---|---|
| `nuvem desligada` | as chaves em `firebase-config.js` ainda são as de exemplo |
| `nuvem com erro` | confira `projectId`/`apiKey`; veja o Console do navegador (F12) |
| `não salvou na nuvem` | regras do Firestore não publicadas, ou sem internet |
| `nuvem sem conexão` | internet caiu — os dados ficam no aparelho e sobem depois |
| nada muda entre aparelhos | está abrindo por `file://` ou as regras bloqueiam leitura |
