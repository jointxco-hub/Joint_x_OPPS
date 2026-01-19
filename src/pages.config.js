import Calculator from './pages/Calculator';
import CatalogManagement from './pages/CatalogManagement';
import ClientCatalog from './pages/ClientCatalog';
import Clients from './pages/Clients';
import Dashboard from './pages/Dashboard';
import Executive from './pages/Executive';
import FileManager from './pages/FileManager';
import Home from './pages/Home';
import Inventory from './pages/Inventory';
import Orders from './pages/Orders';
import ProjectHub from './pages/ProjectHub';
import Projects from './pages/Projects';
import PurchaseOrders from './pages/PurchaseOrders';
import Suppliers from './pages/Suppliers';
import Tasks from './pages/Tasks';
import TrackOrder from './pages/TrackOrder';
import Operations from './pages/Operations';
import SOPLibrary from './pages/SOPLibrary';
import RolesManagement from './pages/RolesManagement';
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
    "Orders": Orders,
    "ProjectHub": ProjectHub,
    "Projects": Projects,
    "PurchaseOrders": PurchaseOrders,
    "Suppliers": Suppliers,
    "Tasks": Tasks,
    "TrackOrder": TrackOrder,
    "Operations": Operations,
    "SOPLibrary": SOPLibrary,
    "RolesManagement": RolesManagement,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};