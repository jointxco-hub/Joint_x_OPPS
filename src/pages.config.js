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
import Calculator from './pages/Calculator';
import CatalogManagement from './pages/CatalogManagement';
import ClientCatalog from './pages/ClientCatalog';
import Clients from './pages/Clients';
import Dashboard from './pages/Dashboard';
import Executive from './pages/Executive';
import FileManager from './pages/FileManager';
import Home from './pages/Home';
import Inventory from './pages/Inventory';
import NotesHub from './pages/NotesHub';
import OnboardingManagement from './pages/OnboardingManagement';
import Operations from './pages/Operations';
import Orders from './pages/Orders';
import ProjectHub from './pages/ProjectHub';
import Projects from './pages/Projects';
import PurchaseOrders from './pages/PurchaseOrders';
import RolesManagement from './pages/RolesManagement';
import SOPEditor from './pages/SOPEditor';
import SOPLibrary from './pages/SOPLibrary';
import SOPView from './pages/SOPView';
import Suppliers from './pages/Suppliers';
import Tasks from './pages/Tasks';
import TrackOrder from './pages/TrackOrder';
import WeeklyCalendar from './pages/WeeklyCalendar';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Calculator": Calculator,
    "CatalogManagement": CatalogManagement,
    "ClientCatalog": ClientCatalog,
    "Clients": Clients,
    "Dashboard": Dashboard,
    "Executive": Executive,
    "FileManager": FileManager,
    "Home": Home,
    "Inventory": Inventory,
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
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};