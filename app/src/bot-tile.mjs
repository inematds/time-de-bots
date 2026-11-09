import { avatarAppearance } from './avatar.mjs';
import { animatedAvatar } from './avatar-motion.mjs';

export function createBotTile(bot, { primary = false, status = 'ready', statusLabel = 'Local demo ready', surface = 'tile', onSelect, onContextMenu } = {}) {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'bot-tile';
  tile.dataset.botId = bot.id;
  tile.setAttribute('aria-label', `${bot.name}, ${statusLabel}`);

  const portrait = document.createElement('span');
  portrait.className = 'bot-tile-portrait';
  const image = animatedAvatar(`${surface}-${bot.id}`,{...avatarAppearance(bot,primary,document.documentElement.dataset.theme||'dark'),follow:'global',mode:status==='busy'?'streaming':'idle'});
  image.classList.add('bot-tile-avatar');
  portrait.append(image);

  const dot = document.createElement('span');
  dot.className = 'bot-tile-status';
  dot.dataset.status = status;
  dot.title = statusLabel;
  dot.setAttribute('aria-hidden', 'true');
  portrait.append(dot);

  const label = document.createElement('span');
  label.className = 'bot-tile-name';
  label.textContent = bot.name;
  tile.append(portrait, label);
  tile.addEventListener('click', () => onSelect?.(bot));
  tile.addEventListener('contextmenu', event => { event.preventDefault(); onContextMenu?.(bot); });
  return tile;
}
