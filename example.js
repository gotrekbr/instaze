'use strict';

const puppeteer = require('puppeteer');

// Carregar variáveis de ambiente do arquivo .env
require('dotenv').config();

const Instauto = require('instauto');

// Opcional: Logger personalizado com marcação de tempo
const log = (fn, ...args) => console[fn](new Date().toISOString(), ...args);
const logger = Object.fromEntries(['log', 'info', 'debug', 'error', 'trace', 'warn'].map((fn) => [fn, (...args) => log(fn, ...args)]));

const options = {
  cookiesPath: './cookies.json',

  username: process.env.INSTAGRAM_USERNAME,
  password: process.env.INSTAGRAM_PASSWORD,

  // Limite global que impede follows ou unfollows (total) de exceder esse número em uma janela deslizante de uma hora:
  maxFollowsPerHour: process.env.MAX_FOLLOWS_PER_HOUR != null ? parseInt(process.env.MAX_FOLLOWS_PER_HOUR, 10) : 20,
  // Limite global que impede follows ou unfollows (total) de exceder esse número em uma janela deslizante de um dia:
  maxFollowsPerDay: process.env.MAX_FOLLOWS_PER_DAY != null ? parseInt(process.env.MAX_FOLLOWS_PER_DAY, 10) : 150,
  // (NOTA: definir os parâmetros acima muito altos causará proibição/aceleração temporária)

  // Limite global que impede likes (total) de exceder esse número em uma janela deslizante de um dia:
  maxLikesPerDay: process.env.MAX_LIKES_PER_DAY != null ? parseInt(process.env.MAX_LIKES_PER_DAY, 10) : 30,

  // Limites de seguidores e seguindo
  followUserMaxFollowers: process.env.FOLLOW_USER_MAX_FOLLOWERS != null ? parseInt(process.env.FOLLOW_USER_MAX_FOLLOWERS, 10) : null,
  followUserMaxFollowing: process.env.FOLLOW_USER_MAX_FOLLOWING != null ? parseInt(process.env.FOLLOW_USER_MAX_FOLLOWING, 10) : null,
  followUserMinFollowers: process.env.FOLLOW_USER_MIN_FOLLOWERS != null ? parseInt(process.env.FOLLOW_USER_MIN_FOLLOWERS, 10) : null,
  followUserMinFollowing: process.env.FOLLOW_USER_MIN_FOLLOWING != null ? parseInt(process.env.FOLLOW_USER_MIN_FOLLOWING, 10) : null,

  // Filtro de lógica personalizado para seguir usuário
  shouldFollowUser: null,
  /* Exemplo para pular contas empresariais
  shouldFollowUser: function (dados) {
  console.log('isBusinessAccount:', dados.isBusinessAccount);
  retornar !dados.isBusinessAccount;
  }, /
  / Exemplo para pular contas com 'crypto' & 'bitcoin' em seu bio ou nome de usuário
  shouldFollowUser: function (dados) {
  console.log('nomeDeUsúario:', dados.username, 'biografia:', dados.biography);
  var palavrasChave = ['crypto', 'bitcoin'];
  se (palavrasChave.find(v => dados.username.includes(v)) !== undefined || palavrasChave.find(v => dados.biography.includes(v)) !== undefined) {
  retornar falso;
  }
  retornar verdadeiro;
  }, */

  // Filtro de lógica personalizado para gostar de mídias
  shouldLikeMedia: null,

  // NOTA: A opção dontUnfollowUntilTimeElapsed é SOMENTE para a função unfollowNonMutualFollowers
  // Isso especifica o tempo durante o qual o bot não deve tocar nos usuários que ele seguiu anteriormente (em milissegundos)
  // Após esse tempo, ele poderá parar de segui-los novamente.
  // TODO deve remover esta opção daqui
  dontUnfollowUntilTimeElapsed: 3 * 24 * 60 * 60 * 1000,

  // Usernames that we should not touch, e.g. your friends and actual followings
  excludeUsers: [],

  // If true, will not do any actions (defaults to true)
  dryRun: false,

  logger,
};

(async () => {
  let browser;

  try {
    browser = await puppeteer.launch({
      // set headless: false first if you need to debug and see how it works
      headless: true,

      args: [
        // Needed for docker
        '--no-sandbox',
        '--disable-setuid-sandbox',

        // If you need to proxy: (see also https://www.chromium.org/developers/design-documents/network-settings)
        // '--proxy-server=127.0.0.1:9876',
      ],
    });

    // Create a database where state will be loaded/saved to
    const instautoDb = await Instauto.JSONDB({
      // Will store a list of all users that have been followed before, to prevent future re-following.
      followedDbPath: './followed.json',
      // Will store all unfollowed users here
      unfollowedDbPath: './unfollowed.json',
      // Will store all likes here
      likedPhotosDbPath: './liked-photos.json',
    });

    const instauto = await Instauto(instautoDb, browser, options);

    // This can be used to unfollow people:
    // Will unfollow auto-followed AND manually followed accounts who are not following us back, after some time has passed
    // The time is specified by config option dontUnfollowUntilTimeElapsed
    // await instauto.unfollowNonMutualFollowers();
    // await instauto.sleep(10 * 60 * 1000);

    // Unfollow previously auto-followed users (regardless of whether or not they are following us back)
    // after a certain amount of days (2 weeks)
    // Leave room to do following after this too (unfollow 2/3 of maxFollowsPerDay)
    const unfollowedCount = await instauto.unfollowOldFollowed({ ageInDays: 14, limit: options.maxFollowsPerDay * (2 / 3) });

    if (unfollowedCount > 0) await instauto.sleep(10 * 60 * 1000);

    // List of usernames that we should follow the followers of, can be celebrities etc.
    const usersToFollowFollowersOf = process.env.USERS_TO_FOLLOW != null ? process.env.USERS_TO_FOLLOW.split(',') : [];

    // Now go through each of these and follow a certain amount of their followers
    await instauto.followUsersFollowers({
      usersToFollowFollowersOf,
      maxFollowsTotal: options.maxFollowsPerDay - unfollowedCount,
      skipPrivate: true,
      enableLikeImages: true,
      likeImagesMax: 3,
    });

    await instauto.sleep(10 * 60 * 1000);

    console.log('Done running');

    await instauto.sleep(30000);
  } catch (err) {
    console.error(err);
  } finally {
    console.log('Closing browser');
    if (browser) await browser.close();
  }
})();
