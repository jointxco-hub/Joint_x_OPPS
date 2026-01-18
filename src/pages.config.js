import Calculator from './pages/Calculator';
import CatalogManagement from './pages/CatalogManagement';
import ClientCatalog from './pages/ClientCatalog';
import Clients from './pages/Clients';
import Dashboard from './pages/Dashboard';
import Executive from './pages/Executive';
import Home from './pages/Home';
import Inventory from './pages/Inventory';
import Orders from './pages/Orders';
import ProjectHub from './pages/ProjectHub';
import Projects from './pages/Projects';
import PurchaseOrders from './pages/PurchaseOrders';
import Suppliers from './pages/Suppliers';
import Tasks from './pages/Tasks';
import TrackOrder from './pages/TrackOrder';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Calculator": Calculator,
    "CatalogManagement": CatalogManagement,
    "ClientCatalog": ClientCatalog,
    "Clients": Clients,
    "Dashboard": Dashboard,
    "Executive": Executive,
    "Home": Home,
    "Inventory": Inventory,
    "Orders": Orders,
    "ProjectHub": ProjectHub,
    "Projects": Projects,
    "PurchaseOrders": PurchaseOrders,
    "Suppliers": Suppliers,
    "Tasks": Tasks,
    "TrackOrder": TrackOrder,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};