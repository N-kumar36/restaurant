import { PrismaClient, UserRole, OrderStatus, PaymentStatus, PaymentMethod, OrderType } from "@prisma/client";
import bcrypt from "bcryptjs";
import QRCode from "qrcode";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting restaurant database seed...");

  // 1. Clean existing records in correct relation order
  await prisma.payment.deleteMany();
  await prisma.orderItemAddon.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.menuItemAddon.deleteMany();
  await prisma.menuItemVariant.deleteMany();
  await prisma.menuItem.deleteMany();
  await prisma.menuCategory.deleteMany();
  await prisma.table.deleteMany();
  await prisma.restaurantSettings.deleteMany();
  await prisma.restaurantMembership.deleteMany();
  await prisma.restaurantImage.deleteMany();
  await prisma.review.deleteMany();
  await prisma.restaurant.deleteMany();
  await prisma.user.deleteMany();

  // 2. Create Users
  const passwordHash = await bcrypt.hash("Admin@123456", 10);
  
  const superAdmin = await prisma.user.create({
    data: {
      email: "admin@saffronember.com",
      name: "Chef Marco Rossi",
      passwordHash,
      role: UserRole.OWNER,
      phone: "+91 98765 43210",
    },
  });

  const manager = await prisma.user.create({
    data: {
      email: "manager@saffronember.com",
      name: "Priya Sharma",
      passwordHash,
      role: UserRole.MANAGER,
      phone: "+91 98765 43211",
    },
  });

  const staff = await prisma.user.create({
    data: {
      email: "staff@saffronember.com",
      name: "Alex Vance",
      passwordHash,
      role: UserRole.STAFF,
      phone: "+91 98765 43212",
    },
  });

  // 3. Create Restaurant
  const restaurant = await prisma.restaurant.create({
    data: {
      name: "Saffron & Ember",
      slug: "saffron-ember",
      tagline: "Artisan Culinary Heritage & Wood-Fired Gastronomy",
      description: "Rooted in authentic wood-fired traditions and infused with vibrant coastal botanicals, Saffron & Ember redefines modern culinary craft. Every dish celebrates handcrafted precision, organic seasonal harvest, and warm hospitality.",
      address: "42 Heritage Boulevard, Indiranagar",
      city: "Bengaluru, Karnataka",
      phone: "+91 80 4912 3456",
      email: "reservations@saffronember.com",
      logoUrl: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=400&q=80",
      coverImageUrl: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1600&q=80",
      currency: "INR",
      taxRate: 5.0,
      serviceChargeRate: 2.5,
      isOpen: true,
      prepTimeMinutes: 22,
      openingHoursJson: JSON.stringify({
        monday: { open: "11:30 AM", close: "11:00 PM", isOpen: true },
        tuesday: { open: "11:30 AM", close: "11:00 PM", isOpen: true },
        wednesday: { open: "11:30 AM", close: "11:00 PM", isOpen: true },
        thursday: { open: "11:30 AM", close: "11:00 PM", isOpen: true },
        friday: { open: "11:30 AM", close: "11:30 PM", isOpen: true },
        saturday: { open: "11:00 AM", close: "11:30 PM", isOpen: true },
        sunday: { open: "11:00 AM", close: "11:00 PM", isOpen: true },
      }),
      socialLinksJson: JSON.stringify({
        instagram: "https://instagram.com/saffronember",
        facebook: "https://facebook.com/saffronember",
        twitter: "https://twitter.com/saffronember",
      }),
    },
  });

  // 4. Restaurant Memberships
  await prisma.restaurantMembership.createMany({
    data: [
      { userId: superAdmin.id, restaurantId: restaurant.id, role: UserRole.OWNER },
      { userId: manager.id, restaurantId: restaurant.id, role: UserRole.MANAGER },
      { userId: staff.id, restaurantId: restaurant.id, role: UserRole.STAFF },
    ],
  });

  // 5. Restaurant Settings
  await prisma.restaurantSettings.create({
    data: {
      restaurantId: restaurant.id,
      allowDineIn: true,
      allowTakeaway: true,
      allowOnlinePayment: true,
      allowPayAtCounter: true,
      autoAcceptOrders: false,
      minimumOrderAmount: 100.0,
    },
  });

  // 6. Tables & QR Code generation
  const tableData = [
    { tableNumber: "T-01", capacity: 2 },
    { tableNumber: "T-02", capacity: 4 },
    { tableNumber: "T-03", capacity: 4 },
    { tableNumber: "T-04", capacity: 6 },
    { tableNumber: "T-05", capacity: 2 },
    { tableNumber: "T-06", capacity: 8 },
    { tableNumber: "T-07", capacity: 4 },
    { tableNumber: "T-08", capacity: 4 },
    { tableNumber: "T-09", capacity: 6 },
    { tableNumber: "T-10", capacity: 2 },
  ];

  const createdTables = [];
  for (const t of tableData) {
    const tableUrl = `http://localhost:3000/menu/${restaurant.slug}?table=${t.tableNumber}`;
    const qrDataUrl = await QRCode.toDataURL(tableUrl, {
      errorCorrectionLevel: "H",
      margin: 2,
      width: 400,
      color: {
        dark: "#1c1917",
        light: "#ffffff",
      },
    });

    const created = await prisma.table.create({
      data: {
        restaurantId: restaurant.id,
        tableNumber: t.tableNumber,
        capacity: t.capacity,
        qrCodeUrl: qrDataUrl,
        isActive: true,
      },
    });
    createdTables.push(created);
  }

  // 7. Categories
  const catStarters = await prisma.menuCategory.create({
    data: {
      restaurantId: restaurant.id,
      name: "Artisan Starters",
      slug: "starters",
      description: "Small plates crafted with ember flames and delicate spices to awaken your palate.",
      displayOrder: 1,
      isActive: true,
    },
  });

  const catMains = await prisma.menuCategory.create({
    data: {
      restaurantId: restaurant.id,
      name: "Signature Mains",
      slug: "mains",
      description: "Centerpiece slow-braised curries, wood-fired cuts, and heirloom delicacies.",
      displayOrder: 2,
      isActive: true,
    },
  });

  const catBreadsRice = await prisma.menuCategory.create({
    data: {
      restaurantId: restaurant.id,
      name: "Stone-Baked & Biryanis",
      slug: "breads-rice",
      description: "Aged long-grain basmati, saffron dum pots, and crisp tandoor hearth breads.",
      displayOrder: 3,
      isActive: true,
    },
  });

  const catDesserts = await prisma.menuCategory.create({
    data: {
      restaurantId: restaurant.id,
      name: "Artisan Desserts",
      slug: "desserts",
      description: "Sweet finishes inspired by regional confections and modern pastry techniques.",
      displayOrder: 4,
      isActive: true,
    },
  });

  const catBeverages = await prisma.menuCategory.create({
    data: {
      restaurantId: restaurant.id,
      name: "Handcrafted Beverages",
      slug: "beverages",
      description: "Cold pressed botanicals, zero-proof shrubs, and artisanal brew refreshers.",
      displayOrder: 5,
      isActive: true,
    },
  });

  // 8. Menu Items with Variants and Add-ons
  // Starter 1: Smoked Truffle Paneer Tikka
  const itemPaneer = await prisma.menuItem.create({
    data: {
      restaurantId: restaurant.id,
      categoryId: catStarters.id,
      name: "Smoked Truffle Paneer Tikka",
      slug: "smoked-truffle-paneer-tikka",
      description: "Cottage cheese marinated in Kashmiri saffron, crushed peppercorn, and white truffle oil, gently smoked over charred hickory.",
      basePrice: 420.0,
      imageUrl: "https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?auto=format&fit=crop&w=800&q=80",
      isVeg: true,
      isAvailable: true,
      isFeatured: true,
      spiceLevel: 2,
      prepTimeMinutes: 15,
      dietaryBadgesJson: JSON.stringify(["Vegetarian", "Chef's Special", "Gluten-Friendly"]),
      allergensJson: JSON.stringify(["Dairy"]),
      displayOrder: 1,
      variants: {
        create: [
          { name: "Regular Portion (6 pcs)", price: 420.0, isDefault: true, displayOrder: 1 },
          { name: "Platter Portion (10 pcs)", price: 650.0, isDefault: false, displayOrder: 2 },
        ],
      },
      addons: {
        create: [
          { name: "Extra Truffle Glaze", price: 60.0, displayOrder: 1 },
          { name: "House Mint Emulsion", price: 40.0, displayOrder: 2 },
        ],
      },
    },
  });

  // Starter 2: Charred Lamb Galouti Kebabs
  await prisma.menuItem.create({
    data: {
      restaurantId: restaurant.id,
      categoryId: catStarters.id,
      name: "Charred Lamb Galouti",
      slug: "charred-lamb-galouti",
      description: "Melt-in-mouth Awadhi spiced lamb medallions, smoked ghee infusion, served atop crisp saffron mini sheermals.",
      basePrice: 580.0,
      imageUrl: "https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?auto=format&fit=crop&w=800&q=80",
      isVeg: false,
      isAvailable: true,
      isFeatured: true,
      spiceLevel: 2,
      prepTimeMinutes: 18,
      dietaryBadgesJson: JSON.stringify(["Signature", "Meat", "Gourmet"]),
      allergensJson: JSON.stringify(["Gluten", "Dairy", "Nuts"]),
      displayOrder: 2,
      variants: {
        create: [
          { name: "Regular (4 Kebabs)", price: 580.0, isDefault: true, displayOrder: 1 },
          { name: "Double (8 Kebabs)", price: 990.0, isDefault: false, displayOrder: 2 },
        ],
      },
      addons: {
        create: [
          { name: "Charred Garlic Labneh", price: 70.0, displayOrder: 1 },
          { name: "Pickled Pearl Onions", price: 30.0, displayOrder: 2 },
        ],
      },
    },
  });

  // Starter 3: Crispy Lotus Stem Honey Chili
  await prisma.menuItem.create({
    data: {
      restaurantId: restaurant.id,
      categoryId: catStarters.id,
      name: "Wild Honey Crispy Lotus Stem",
      slug: "crispy-lotus-stem",
      description: "Wok-tossed lotus stem crisps with organic wild mountain honey, roasted sesame, and scallion curls.",
      basePrice: 380.0,
      imageUrl: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=800&q=80",
      isVeg: true,
      isAvailable: true,
      isFeatured: false,
      spiceLevel: 1,
      prepTimeMinutes: 12,
      dietaryBadgesJson: JSON.stringify(["Vegetarian", "Vegan-Friendly", "Crispy"]),
      allergensJson: JSON.stringify(["Sesame"]),
      displayOrder: 3,
    },
  });

  // Mains 1: Slow Braised Nalli Rogan Josh
  await prisma.menuItem.create({
    data: {
      restaurantId: restaurant.id,
      categoryId: catMains.id,
      name: "Slow-Braised Nalli Rogan Josh",
      slug: "slow-braised-nalli-rogan-josh",
      description: "Tender lamb shank simmered for 8 hours with Kashmiri cockscomb flower, ground fennel, dried ginger, and cold-pressed mustard essence.",
      basePrice: 720.0,
      imageUrl: "https://images.unsplash.com/photo-1545247181-516773cae754?auto=format&fit=crop&w=800&q=80",
      isVeg: false,
      isAvailable: true,
      isFeatured: true,
      spiceLevel: 3,
      prepTimeMinutes: 25,
      dietaryBadgesJson: JSON.stringify(["Signature", "Slow-Cooked", "Rich"]),
      allergensJson: JSON.stringify(["Mustard"]),
      displayOrder: 1,
      addons: {
        create: [
          { name: "Extra Bone Marrow Jus", price: 120.0, displayOrder: 1 },
          { name: "Crispy Saffron Flakes", price: 50.0, displayOrder: 2 },
        ],
      },
    },
  });

  // Mains 2: Hearth-Smoked Butter Chicken
  await prisma.menuItem.create({
    data: {
      restaurantId: restaurant.id,
      categoryId: catMains.id,
      name: "Hearth-Smoked Butter Chicken",
      slug: "hearth-smoked-butter-chicken",
      description: "Charcoal-tandoor chicken morsels cooked in a velvety sun-ripened plum tomato gravy, finished with farm butter and fenugreek dust.",
      basePrice: 590.0,
      imageUrl: "https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?auto=format&fit=crop&w=800&q=80",
      isVeg: false,
      isAvailable: true,
      isFeatured: true,
      spiceLevel: 2,
      prepTimeMinutes: 20,
      dietaryBadgesJson: JSON.stringify(["Bestseller", "Comfort Classic"]),
      allergensJson: JSON.stringify(["Dairy", "Cashew"]),
      displayOrder: 2,
      variants: {
        create: [
          { name: "Boneless Classic", price: 590.0, isDefault: true, displayOrder: 1 },
          { name: "Bone-in Country Chicken", price: 640.0, isDefault: false, displayOrder: 2 },
        ],
      },
    },
  });

  // Mains 3: Dal Saffron Ember (24-Hour Black Lentils)
  await prisma.menuItem.create({
    data: {
      restaurantId: restaurant.id,
      categoryId: catMains.id,
      name: "Dal Saffron Ember (24-Hour)",
      slug: "dal-saffron-ember",
      description: "Whole black urad lentils slow-simmered over live charcoal embers for 24 hours with organic butter, cream, and home-churned ghee.",
      basePrice: 450.0,
      imageUrl: "https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=800&q=80",
      isVeg: true,
      isAvailable: true,
      isFeatured: true,
      spiceLevel: 1,
      prepTimeMinutes: 15,
      dietaryBadgesJson: JSON.stringify(["Vegetarian", "Signature", "Comfort Classic"]),
      allergensJson: JSON.stringify(["Dairy"]),
      displayOrder: 3,
      addons: {
        create: [
          { name: "Double Butter Swirl", price: 40.0, displayOrder: 1 },
          { name: "Tandoori Roasted Garlic", price: 30.0, displayOrder: 2 },
        ],
      },
    },
  });

  // Breads & Rice: Awadhi Dum Biryani
  await prisma.menuItem.create({
    data: {
      restaurantId: restaurant.id,
      categoryId: catBreadsRice.id,
      name: "Saffron Spiced Dum Biryani",
      slug: "saffron-spiced-dum-biryani",
      description: "Aged long-grain Dehradun basmati rice sealed in earthen pots with fragrant whole spices, kewra essence, and tender protein.",
      basePrice: 620.0,
      imageUrl: "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?auto=format&fit=crop&w=800&q=80",
      isVeg: false,
      isAvailable: true,
      isFeatured: true,
      spiceLevel: 2,
      prepTimeMinutes: 25,
      dietaryBadgesJson: JSON.stringify(["Signature", "Earthen Pot Dum", "Fragrant"]),
      allergensJson: JSON.stringify(["Dairy"]),
      displayOrder: 1,
      variants: {
        create: [
          { name: "Subz (Seasonal Vegetable & Paneer)", price: 520.0, isDefault: false, displayOrder: 1 },
          { name: "Chicken Tikka Dum", price: 620.0, isDefault: true, displayOrder: 2 },
          { name: "Gosht (Tender Mutton)", price: 740.0, isDefault: false, displayOrder: 3 },
        ],
      },
      addons: {
        create: [
          { name: "Burani Garlic Raita", price: 60.0, displayOrder: 1 },
          { name: "Mirchi Ka Salan", price: 70.0, displayOrder: 2 },
        ],
      },
    },
  });

  // Breads & Rice: Truffle Garlic Naan
  await prisma.menuItem.create({
    data: {
      restaurantId: restaurant.id,
      categoryId: catBreadsRice.id,
      name: "Charred Garlic & Truffle Naan",
      slug: "charred-garlic-truffle-naan",
      description: "Clay oven baked flatbread brushed with black summer truffle butter and toasted roasted garlic flakes.",
      basePrice: 160.0,
      imageUrl: "https://images.unsplash.com/photo-1533777857889-4be7c70b33f7?auto=format&fit=crop&w=800&q=80",
      isVeg: true,
      isAvailable: true,
      isFeatured: false,
      spiceLevel: 1,
      prepTimeMinutes: 8,
      dietaryBadgesJson: JSON.stringify(["Vegetarian", "Artisan Bread"]),
      allergensJson: JSON.stringify(["Gluten", "Dairy"]),
      displayOrder: 2,
    },
  });

  // Desserts: Saffron Pistachio Tres Leches
  await prisma.menuItem.create({
    data: {
      restaurantId: restaurant.id,
      categoryId: catDesserts.id,
      name: "Saffron Pistachio Tres Leches",
      slug: "saffron-pistachio-tres-leches",
      description: "Airy sponge cake steeped in cardamom infused three milks, crowned with Iranian saffron strands and crushed green pistachio.",
      basePrice: 340.0,
      imageUrl: "https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=800&q=80",
      isVeg: true,
      isAvailable: true,
      isFeatured: true,
      spiceLevel: 0,
      prepTimeMinutes: 10,
      dietaryBadgesJson: JSON.stringify(["Vegetarian", "Signature Sweet"]),
      allergensJson: JSON.stringify(["Dairy", "Gluten", "Nuts"]),
      displayOrder: 1,
    },
  });

  // Desserts: Smoked Jaggery Baked Rasgulla
  await prisma.menuItem.create({
    data: {
      restaurantId: restaurant.id,
      categoryId: catDesserts.id,
      name: "Smoked Palm Jaggery Baked Rasgulla",
      slug: "baked-nolen-gur-rasgulla",
      description: "Caramelized chenna dumplings baked in thick nolen gur reduction, finished with silver leaf.",
      basePrice: 290.0,
      imageUrl: "https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=800&q=80",
      isVeg: true,
      isAvailable: true,
      isFeatured: false,
      spiceLevel: 0,
      prepTimeMinutes: 10,
      dietaryBadgesJson: JSON.stringify(["Vegetarian", "Seasonal"]),
      allergensJson: JSON.stringify(["Dairy"]),
      displayOrder: 2,
    },
  });

  // Beverages: Kokum Basil Sparkler
  await prisma.menuItem.create({
    data: {
      restaurantId: restaurant.id,
      categoryId: catBeverages.id,
      name: "Wild Kokum & Sweet Basil Cooler",
      slug: "wild-kokum-sweet-basil-cooler",
      description: "Cold-infused Konkan kokum fruit syrup, crushed holy basil leaves, Himalayan pink salt, and sparkling soda.",
      basePrice: 220.0,
      imageUrl: "https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=800&q=80",
      isVeg: true,
      isAvailable: true,
      isFeatured: true,
      spiceLevel: 0,
      prepTimeMinutes: 5,
      dietaryBadgesJson: JSON.stringify(["Vegan", "Zero-Proof", "Refreshing"]),
      allergensJson: JSON.stringify([]),
      displayOrder: 1,
    },
  });

  // Beverages: Ember Smoked Whiskey Sour (Mocktail)
  await prisma.menuItem.create({
    data: {
      restaurantId: restaurant.id,
      categoryId: catBeverages.id,
      name: "Charred Orange Smoked Refresher",
      slug: "charred-orange-smoked-refresher",
      description: "Torch-caramelized blood orange juice, aromatic bitters, rosemary smoke mist, and tonic.",
      basePrice: 260.0,
      imageUrl: "https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=800&q=80",
      isVeg: true,
      isAvailable: true,
      isFeatured: false,
      spiceLevel: 0,
      prepTimeMinutes: 7,
      dietaryBadgesJson: JSON.stringify(["Mocktail", "Citrus", "Crafted"]),
      allergensJson: JSON.stringify([]),
      displayOrder: 2,
    },
  });

  // 9. Restaurant Gallery Images
  await prisma.restaurantImage.createMany({
    data: [
      {
        restaurantId: restaurant.id,
        title: "Artisanal Dining Ambience",
        imageUrl: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1200&q=80",
        category: "AMBIENCE",
        displayOrder: 1,
      },
      {
        restaurantId: restaurant.id,
        title: "Open Hearth Charcoal Oven",
        imageUrl: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1200&q=80",
        category: "INTERIOR",
        displayOrder: 2,
      },
      {
        restaurantId: restaurant.id,
        title: "Signature Saffron Biryani Crafting",
        imageUrl: "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?auto=format&fit=crop&w=1200&q=80",
        category: "FOOD",
        displayOrder: 3,
      },
      {
        restaurantId: restaurant.id,
        title: "Slow-Braised Nalli Preparation",
        imageUrl: "https://images.unsplash.com/photo-1545247181-516773cae754?auto=format&fit=crop&w=1200&q=80",
        category: "FOOD",
        displayOrder: 4,
      },
      {
        restaurantId: restaurant.id,
        title: "Artisan Dessert Station",
        imageUrl: "https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=1200&q=80",
        category: "FOOD",
        displayOrder: 5,
      },
      {
        restaurantId: restaurant.id,
        title: "The Botanical Bar Counter",
        imageUrl: "https://images.unsplash.com/photo-1514933651103-005eec06c04b?auto=format&fit=crop&w=1200&q=80",
        category: "AMBIENCE",
        displayOrder: 6,
      },
    ],
  });

  // 10. Reviews
  await prisma.review.createMany({
    data: [
      {
        restaurantId: restaurant.id,
        customerName: "Aarav Mehra",
        rating: 5,
        comment: "An extraordinary culinary voyage! The Smoked Truffle Paneer and 24-hour Dal are unmatched in the city. The QR ordering was instantaneous and delightful.",
        isApproved: true,
        isFeatured: true,
      },
      {
        restaurantId: restaurant.id,
        customerName: "Dr. Evelyn Reed",
        rating: 5,
        comment: "The ambience exudes refinement without pretence. Every single plate is composed with impeccable balance of smoke and aroma. Truly Michelin caliber.",
        isApproved: true,
        isFeatured: true,
      },
      {
        restaurantId: restaurant.id,
        customerName: "Karan Singhania",
        rating: 5,
        comment: "Scanning the QR code at Table 04 brought up the menu effortlessly. Food arrived piping hot within 18 minutes. The Galouti kebabs melted immediately.",
        isApproved: true,
        isFeatured: true,
      },
      {
        restaurantId: restaurant.id,
        customerName: "Sunita Nambiar",
        rating: 5,
        comment: "Exceptional dining experience! The Saffron Tres Leches is now our family's favorite dessert. We will keep coming back.",
        isApproved: true,
        isFeatured: true,
      },
    ],
  });

  // 11. Create a sample initial order for dashboard analytics
  const sampleOrder = await prisma.order.create({
    data: {
      orderNumber: "ORD-2026-1001",
      restaurantId: restaurant.id,
      tableId: createdTables[1].id,
      customerName: "Rohan Kapoor",
      customerPhone: "+91 99887 76655",
      orderType: OrderType.DINE_IN,
      status: OrderStatus.PREPARING,
      paymentStatus: PaymentStatus.PAID,
      paymentMethod: PaymentMethod.RAZORPAY,
      subtotal: 1040.0,
      taxAmount: 52.0,
      serviceCharge: 26.0,
      totalAmount: 1118.0,
      notes: "Please make the Tikka mild spicy",
      estimatedPrepMinutes: 20,
      items: {
        create: [
          {
            menuItemId: itemPaneer.id,
            itemNameSnapshot: "Smoked Truffle Paneer Tikka",
            unitPriceSnapshot: 420.0,
            quantity: 1,
            totalPriceSnapshot: 420.0,
            variantNameSnapshot: "Regular Portion (6 pcs)",
            notes: "Mild spice",
            addons: {
              create: [
                {
                  addonNameSnapshot: "Extra Truffle Glaze",
                  priceSnapshot: 60.0,
                  quantity: 1,
                },
              ],
            },
          },
          {
            itemNameSnapshot: "Slow-Braised Nalli Rogan Josh",
            unitPriceSnapshot: 720.0,
            quantity: 1,
            totalPriceSnapshot: 720.0,
            variantNameSnapshot: "Standard Cut",
          },
        ],
      },
      payments: {
        create: [
          {
            paymentGateway: "RAZORPAY",
            gatewayOrderId: "order_mock_test_1001",
            gatewayPaymentId: "pay_mock_test_1001",
            amount: 1118.0,
            currency: "INR",
            status: PaymentStatus.PAID,
          },
        ],
      },
    },
  });

  console.log("✅ Seed completed successfully!");
  console.log(`- Restaurant: ${restaurant.name} (slug: ${restaurant.slug})`);
  console.log(`- Admin login: admin@saffronember.com / Admin@123456`);
  console.log(`- Manager login: manager@saffronember.com / Admin@123456`);
  console.log(`- Staff login: staff@saffronember.com / Admin@123456`);
  console.log(`- Created ${createdTables.length} tables with QR codes`);
  console.log(`- Created sample active order: ${sampleOrder.orderNumber}`);
}

main()
  .catch((e) => {
    console.error("❌ Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

