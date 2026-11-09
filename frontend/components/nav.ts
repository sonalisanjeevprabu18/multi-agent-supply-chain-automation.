import {
  BarChart3,
  Bot,
  Boxes,
  LayoutDashboard,
  Settings,
  ShoppingCart,
  TrendingUp,
  TriangleAlert,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  title: string;
  description: string;
  icon: LucideIcon;
  section: "Operate" | "Intelligence";
}

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Overview",
    title: "Overview",
    description: "Executive position across demand, stock, suppliers and agents",
    icon: LayoutDashboard,
    section: "Operate",
  },
  {
    href: "/forecasting",
    label: "Demand Forecasting",
    title: "Demand Forecasting",
    description: "XGBoost demand models with a moving-average benchmark",
    icon: TrendingUp,
    section: "Operate",
  },
  {
    href: "/inventory",
    label: "Inventory Management",
    title: "Inventory Management",
    description: "Safety stock, reorder points and replenishment recommendations",
    icon: Boxes,
    section: "Operate",
  },
  {
    href: "/warehouses",
    label: "Warehouse Operations",
    title: "Warehouse Operations",
    description: "Capacity, valuation and transfer activity by facility",
    icon: Warehouse,
    section: "Operate",
  },
  {
    href: "/procurement",
    label: "Procurement",
    title: "Procurement",
    description: "Supplier scoring and purchase-order recommendations",
    icon: ShoppingCart,
    section: "Operate",
  },
  {
    href: "/disruptions",
    label: "Disruption Management",
    title: "Disruption Management",
    description: "Supplier risk simulation and recovery planning",
    icon: TriangleAlert,
    section: "Intelligence",
  },
  {
    href: "/agents",
    label: "AI Agent Control Center",
    title: "AI Agent Control Center",
    description: "LangGraph execution records for the seven specialised agents",
    icon: Bot,
    section: "Intelligence",
  },
  {
    href: "/reports",
    label: "Reports & Analytics",
    title: "Reports & Analytics",
    description: "Forecast quality, inventory exposure and procurement spend",
    icon: BarChart3,
    section: "Intelligence",
  },
  {
    href: "/settings",
    label: "Settings",
    title: "Settings",
    description: "Connection health, locale and workspace preferences",
    icon: Settings,
    section: "Intelligence",
  },
];

export function navItemFor(pathname: string): NavItem {
  if (pathname === "/") return NAV_ITEMS[0];
  return (
    NAV_ITEMS.find((item) => item.href !== "/" && pathname.startsWith(item.href)) ??
    NAV_ITEMS[0]
  );
}
