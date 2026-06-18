/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import { lazy } from 'react';
import __Layout from './Layout.jsx';

const AletheaBrandOS = lazy(() => import('./pages/AletheaBrandOS'));
const AletheaClientPortal = lazy(() => import('./pages/AletheaClientPortal'));
const AletheaPhaseDetail = lazy(() => import('./pages/AletheaPhaseDetail'));
const AletheaProjectBuilder = lazy(() => import('./pages/AletheaProjectBuilder'));
const AletheaProjectView = lazy(() => import('./pages/AletheaProjectView'));
const Calculator = lazy(() => import('./pages/Calculator'));
const CatalogManagement = lazy(() => import('./pages/CatalogManagement'));
const ClientCatalog = lazy(() => import('./pages/ClientCatalog'));
const ClientRequests = lazy(() => import('./pages/ClientRequests'));
const Clients = lazy(() => import('./pages/Clients'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Executive = lazy(() => import('./pages/Executive'));
const FileManager = lazy(() => import('./pages/FileManager'));
const Home = lazy(() => import('./pages/Home'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Invoices = lazy(() => import('./pages/Invoices'));
const NotesHub = lazy(() => import('./pages/NotesHub'));
const OnboardingManagement = lazy(() => import('./pages/OnboardingManagement'));
const Operations = lazy(() => import('./pages/Operations'));
const Orders = lazy(() => import('./pages/Orders'));
const ProjectHub = lazy(() => import('./pages/ProjectHub'));
const Projects = lazy(() => import('./pages/Projects'));
const PurchaseOrders = lazy(() => import('./pages/PurchaseOrders'));
const RolesManagement = lazy(() => import('./pages/RolesManagement'));
const SOPEditor = lazy(() => import('./pages/SOPEditor'));
const SOPLibrary = lazy(() => import('./pages/SOPLibrary'));
const SOPView = lazy(() => import('./pages/SOPView'));
const Suppliers = lazy(() => import('./pages/Suppliers'));
const Tasks = lazy(() => import('./pages/Tasks'));
const TrackOrder = lazy(() => import('./pages/TrackOrder'));
const WeeklyCalendar = lazy(() => import('./pages/WeeklyCalendar'));
const OpsCalendar = lazy(() => import('./pages/OpsCalendar'));
const UserDashboard = lazy(() => import('./pages/UserDashboard'));
const TeamProfiles = lazy(() => import('./pages/TeamProfiles'));
const TeamExpenses = lazy(() => import('./pages/TeamExpenses'));
const ArchivePage = lazy(() => import('./pages/Archive'));
const SignIn = lazy(() => import('./pages/SignIn'));
const OffersDashboard = lazy(() => import('./pages/OffersDashboard'));
const MoneyModel = lazy(() => import('./pages/MoneyModel'));
const Goals = lazy(() => import('./pages/Goals'));


export const PAGES = {
    "AletheaBrandOS": AletheaBrandOS,
    "AletheaClientPortal": AletheaClientPortal,
    "AletheaPhaseDetail": AletheaPhaseDetail,
    "AletheaProjectBuilder": AletheaProjectBuilder,
    "AletheaProjectView": AletheaProjectView,
    "Calculator": Calculator,
    "CatalogManagement": CatalogManagement,
    "ClientCatalog": ClientCatalog,
    "ClientRequests": ClientRequests,
    "Clients": Clients,
    "Dashboard": Dashboard,
    "Executive": Executive,
    "FileManager": FileManager,
    "Home": Home,
    "Inventory": Inventory,
    "Invoices": Invoices,
    "NotesHub": NotesHub,
    "OnboardingManagement": OnboardingManagement,
    "Operations": Operations,
    "Orders": Orders,
    "ProjectHub": ProjectHub,
    "Projects": Projects,
    "PurchaseOrders": PurchaseOrders,
    "RolesManagement": RolesManagement,
    "SOPEditor": SOPEditor,
    "SOPLibrary": SOPLibrary,
    "SOPView": SOPView,
    "Suppliers": Suppliers,
    "Tasks": Tasks,
    "TrackOrder": TrackOrder,
    "WeeklyCalendar": WeeklyCalendar,
    "OpsCalendar": OpsCalendar,
    "TeamProfiles": TeamProfiles,
    "TeamExpenses": TeamExpenses,
    "Archive": ArchivePage,
    "UserDashboard": UserDashboard,
    "SignIn": SignIn,
    "OffersDashboard": OffersDashboard,
    "MoneyModel": MoneyModel,
    "Goals": Goals,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};

// NOTE: Dashboard is the main page and loads at "/"
