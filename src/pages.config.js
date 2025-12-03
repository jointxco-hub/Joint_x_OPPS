import Dashboard from './pages/Dashboard';
import Orders from './pages/Orders';
import Tasks from './pages/Tasks';
import Calculator from './pages/Calculator';
import TrackOrder from './pages/TrackOrder';
import Suppliers from './pages/Suppliers';
import PurchaseOrders from './pages/PurchaseOrders';
import Inventory from './pages/Inventory';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Dashboard": Dashboard,
    "Orders": Orders,
    "Tasks": Tasks,
    "Calculator": Calculator,
    "TrackOrder": TrackOrder,
    "Suppliers": Suppliers,
    "PurchaseOrders": PurchaseOrders,
    "Inventory": Inventory,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};