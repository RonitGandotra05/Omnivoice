import {
  ArrowUpRightIcon,
  ArrowRightIcon,
  PlayIcon,
  CheckIcon,
  PhoneIcon,
  BoltIcon,
  ShieldCheckIcon,
  AdjustmentsHorizontalIcon,
  DocumentTextIcon,
  Bars3Icon,
  XMarkIcon,
  BeakerIcon,
  ChatBubbleLeftRightIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
const icons = {
  arrow: ArrowUpRightIcon,
  right: ArrowRightIcon,
  play: PlayIcon,
  check: CheckIcon,
  phone: PhoneIcon,
  bolt: BoltIcon,
  shield: ShieldCheckIcon,
  settings: AdjustmentsHorizontalIcon,
  document: DocumentTextIcon,
  menu: Bars3Icon,
  close: XMarkIcon,
  test: BeakerIcon,
  chat: ChatBubbleLeftRightIcon,
  reset: ArrowPathIcon,
};
export default function Icon({ name, className = "", ...props }) {
  const Component = icons[name] || ArrowUpRightIcon;
  return (
    <Component aria-hidden="true" className={`icon ${className}`} {...props} />
  );
}
