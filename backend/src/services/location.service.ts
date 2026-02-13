import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import Papa from 'papaparse';

const prisma = new PrismaClient();

export interface LocationFilters {
  brand?: string;
  type?: string;
  country?: string;
  city?: string;
  status?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface NearbyParams {
  latitude: number;
  longitude: number;
  radius: number; // in miles
  filters?: LocationFilters;
}

export interface ImportResult {
  success: boolean;
  newCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  errors: string[];
}

class LocationService {
  /**
   * Import locations from CSV file to database
   */
  async importFromCSV(csvFilePath: string): Promise<ImportResult> {
    const result: ImportResult = {
      success: false,
      newCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      errors: []
    };

    try {
      // Read and parse CSV file
      const fileContent = fs.readFileSync(csvFilePath, 'utf-8');
      const parseResult = Papa.parse(fileContent, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header: string) => header.trim()
      });

      const rows = parseResult.data as any[];

      console.log(`[LocationService] Importing ${rows.length} rows from CSV...`);

      for (const row of rows) {
        try {
          // Validate required fields
          if (!row.Handle || !row.Name) {
            result.skippedCount++;
            continue;
          }

          // Parse latitude and longitude
          const latitude = parseFloat(row.Latitude);
          const longitude = parseFloat(row.Longitude);

          if (isNaN(latitude) || isNaN(longitude)) {
            result.skippedCount++;
            result.errors.push(`Invalid coordinates for ${row.Name}: lat=${row.Latitude}, lng=${row.Longitude}`);
            continue;
          }

          // Prepare location data
          const locationData = {
            handle: row.Handle.trim(),
            name: row.Name.trim(),
            status: row.Status?.toLowerCase() === 'active' || row.Status?.toLowerCase() === 'true' || !row.Status,
            addressLine1: row['Address Line 1'] || '',
            addressLine2: row['Address Line 2'] || null,
            postalCode: row['Postal/ZIP Code'] || null,
            city: row.City || '',
            stateProvinceRegion: row['State/Province/Region'] || null,
            country: row.Country || '',
            phone: row.Phone || null,
            email: row.Email || null,
            website: row.Website || null,
            imageUrl: row['Image URL'] || null,
            latitude,
            longitude,

            // Hours
            monday: row.Monday || null,
            tuesday: row.Tuesday || null,
            wednesday: row.Wednesday || null,
            thursday: row.Thursday || null,
            friday: row.Friday || null,
            saturday: row.Saturday || null,
            sunday: row.Sunday || null,

            // SEO
            pageTitle: row['Page Title'] || null,
            pageDescription: row['Page Description'] || null,
            metaTitle: row['Meta Title'] || null,
            metaDescription: row['Meta Description'] || null,

            // Other
            priority: row.Priority ? parseInt(row.Priority) : null,
            tags: row.Tags || null,
            customBrands: row['Custom Brands'] || null,

            // Localization (French)
            nameFr: row['Name (French)'] || null,
            pageTitleFr: row['Page Title (French)'] || null,
            pageDescriptionFr: row['Page Description (French)'] || null,
            customBrandsFr: row['Custom Brands (French)'] || null,

            // Localization (Chinese)
            nameZhCn: row['Name (Chinese Simplified)'] || null,
            pageTitleZhCn: row['Page Title (Chinese Simplified)'] || null,
            pageDescriptionZhCn: row['Page Description (Chinese Simplified)'] || null,
            customBrandsZhCn: row['Custom Brands (Chinese Simplified)'] || null,

            // Localization (Spanish)
            nameEs: row['Name (Spanish)'] || null,
            pageTitleEs: row['Page Title (Spanish)'] || null,
            pageDescriptionEs: row['Page Description (Spanish)'] || null,
            customBrandsEs: row['Custom Brands (Spanish)'] || null,

            // Custom Buttons
            customButton1Title: row['Custom Button 1 Title'] || null,
            customButton1Url: row['Custom Button 1 URL'] || null,
            customButton2Title: row['Custom Button 2 Title'] || null,
            customButton2Url: row['Custom Button 2 URL'] || null,

            // Custom Buttons - Localized
            customButton1TitleFr: row['Custom Button 1 Title (French)'] || null,
            customButton1UrlFr: row['Custom Button 1 URL (French)'] || null,
            customButton1TitleZhCn: row['Custom Button 1 Title (Chinese Simplified)'] || null,
            customButton1UrlZhCn: row['Custom Button 1 URL (Chinese Simplified)'] || null,
            customButton1TitleEs: row['Custom Button 1 Title (Spanish)'] || null,
            customButton1UrlEs: row['Custom Button 1 URL (Spanish)'] || null,

            customButton2TitleFr: row['Custom Button 2 Title (French)'] || null,
            customButton2UrlFr: row['Custom Button 2 URL (French)'] || null,
            customButton2TitleZhCn: row['Custom Button 2 Title (Chinese Simplified)'] || null,
            customButton2UrlZhCn: row['Custom Button 2 URL (Chinese Simplified)'] || null,
            customButton2TitleEs: row['Custom Button 2 Title (Spanish)'] || null,
            customButton2UrlEs: row['Custom Button 2 URL (Spanish)'] || null,
          };

          // Upsert location (update if exists, create if new)
          const existingLocation = await prisma.location.findUnique({
            where: { handle: locationData.handle }
          });

          await prisma.location.upsert({
            where: { handle: locationData.handle },
            update: locationData,
            create: locationData
          });

          if (existingLocation) {
            result.updatedCount++;
          } else {
            result.newCount++;
          }

        } catch (error: any) {
          result.errorCount++;
          result.errors.push(`Error importing ${row.Name || 'unknown'}: ${error.message}`);
          console.error(`[LocationService] Error importing row:`, error);
        }
      }

      result.success = true;
      console.log(`[LocationService] Import complete: ${result.newCount} new, ${result.updatedCount} updated, ${result.skippedCount} skipped, ${result.errorCount} errors`);

    } catch (error: any) {
      result.success = false;
      result.errors.push(`Failed to read/parse CSV: ${error.message}`);
      console.error('[LocationService] Import failed:', error);
    }

    return result;
  }

  /**
   * Get all locations with optional filtering and pagination
   */
  async findAll(filters: LocationFilters = {}) {
    const {
      brand,
      type,
      country,
      city,
      status,
      search,
      limit = 100,
      offset = 0
    } = filters;

    const where: any = {};

    // Filter by brand (partial match in customBrands)
    if (brand) {
      where.customBrands = {
        contains: brand
      };
    }

    // Filter by country
    if (country) {
      where.country = country;
    }

    // Filter by city
    if (city) {
      where.city = city;
    }

    // Filter by status
    if (status !== undefined) {
      where.status = status;
    }

    // Search by name
    if (search) {
      where.name = {
        contains: search
      };
    }

    const [locations, total] = await Promise.all([
      prisma.location.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { name: 'asc' }
      }),
      prisma.location.count({ where })
    ]);

    return {
      data: locations,
      total,
      page: Math.floor(offset / limit) + 1,
      limit,
      hasMore: offset + limit < total
    };
  }

  /**
   * Find locations near a specific coordinate within a radius
   */
  async findNearby(params: NearbyParams) {
    const { latitude, longitude, radius, filters = {} } = params;

    // Get all locations with filters applied
    const { data: allLocations } = await this.findAll({
      ...filters,
      limit: 10000 // Get all for distance calculation
    });

    // Calculate distance for each location
    const locationsWithDistance = allLocations.map(location => {
      const distance = this.calculateDistance(
        latitude,
        longitude,
        location.latitude,
        location.longitude
      );

      return {
        ...location,
        distance
      };
    });

    // Filter by radius and sort by distance
    const nearbyLocations = locationsWithDistance
      .filter(loc => loc.distance <= radius)
      .sort((a, b) => a.distance - b.distance);

    return {
      data: nearbyLocations,
      total: nearbyLocations.length,
      centerLat: latitude,
      centerLng: longitude,
      radius
    };
  }

  /**
   * Find a single location by ID
   */
  async findById(id: string) {
    return await prisma.location.findUnique({
      where: { id }
    });
  }

  /**
   * Search locations by name or address
   */
  async search(query: string, limit: number = 50) {
    const locations = await prisma.location.findMany({
      where: {
        OR: [
          { name: { contains: query } },
          { addressLine1: { contains: query } },
          { city: { contains: query } }
        ]
      },
      take: limit,
      orderBy: { name: 'asc' }
    });

    return {
      data: locations,
      total: locations.length,
      query
    };
  }

  /**
   * Get unique list of brands from all locations
   */
  async getBrands() {
    const locations = await prisma.location.findMany({
      select: { customBrands: true },
      where: {
        customBrands: { not: null }
      }
    });

    const brandsSet = new Set<string>();
    locations.forEach(loc => {
      if (loc.customBrands) {
        const brands = loc.customBrands.split(',').map(b => b.trim());
        brands.forEach(brand => brandsSet.add(brand));
      }
    });

    return Array.from(brandsSet).sort();
  }

  /**
   * Get statistics about locations
   */
  async getStats() {
    const [total, activeCount, countries, cities, brands] = await Promise.all([
      prisma.location.count(),
      prisma.location.count({ where: { status: true } }),
      prisma.location.groupBy({
        by: ['country'],
        _count: true
      }),
      prisma.location.groupBy({
        by: ['city'],
        _count: true
      }),
      this.getBrands()
    ]);

    return {
      total,
      active: activeCount,
      inactive: total - activeCount,
      countries: countries.length,
      cities: cities.length,
      brands: brands.length,
      topCountries: countries
        .sort((a, b) => b._count - a._count)
        .slice(0, 10)
        .map(c => ({ country: c.country, count: c._count })),
      topCities: cities
        .sort((a, b) => b._count - a._count)
        .slice(0, 10)
        .map(c => ({ city: c.city, count: c._count }))
    };
  }

  /**
   * Calculate distance between two coordinates using Haversine formula
   * Returns distance in miles
   */
  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 3959; // Earth's radius in miles
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(lat1)) *
      Math.cos(this.deg2rad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    return Math.round(distance * 10) / 10; // Round to 1 decimal place
  }

  private deg2rad(deg: number): number {
    return deg * (Math.PI / 180);
  }
}

export default new LocationService();
