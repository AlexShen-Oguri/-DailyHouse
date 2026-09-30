import { usePreferences } from './Preferences';
import { tomatoFrame } from './pomodoro-model';

export default function TomatoPlant({ progress, minutes, growing, resting }: { progress: number; minutes: number; growing: boolean; resting: boolean }) {
  const { t } = usePreferences();
  const frame = tomatoFrame(progress, minutes);
  const fruit = frame.variant === 'small' ? t('红色小番茄', 'Small red tomatoes') : frame.variant === 'large' ? t('红色大番茄', 'Large red tomatoes') : t('金色大番茄', 'Large gold tomatoes');
  const stage = [t('番茄苗', 'Seedling'), t('长出新叶', 'New leaves'), t('开花了', 'Blossoms'), t('果实渐熟', 'Ripening'), t('番茄成熟', 'Ripe tomatoes')][frame.stage];
  return <div className={`tomato-growth${growing ? ' is-growing' : ''}`} data-stage={frame.stage} data-fruit={frame.variant}>
    <div className="tomato-plant" role="img" aria-label={`${stage} · ${fruit}`} style={{ backgroundPosition: `${frame.column * 50}% ${frame.row * 50}%` }}/>
    <p className="tomato-caption">{resting ? progress === 1 ? t('收成留在这里，先歇一会儿。', 'Keep your harvest here. Take a break.') : t('先休息，准备好再种下一轮。', 'Rest, then plant a new round.') : progress === 1 ? t(`${fruit}成熟了。`, `${fruit} are ripe.`) : t(`这轮将结出${fruit}。`, `This round grows ${fruit.toLowerCase()}.`)}</p>
  </div>;
}
